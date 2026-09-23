# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status

from plane.db.models import IssueCyberneticsRecord
from plane.tests.contract.app.conftest_cybernetics import (
    ADMIN,
    GUEST,
    MEMBER,
    assert_error,
    config_url,
    records_url,
)
from plane.tests.factories import IssueCyberneticsRecordFactory, IssueFactory
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data.client import CyberneticsForbidden, CyberneticsNotFound, CyberneticsUnreachable

pytest_plugins = ["plane.tests.contract.app.conftest_cybernetics"]
pytestmark = [pytest.mark.contract, pytest.mark.django_db]

BASE = "bseAAAAAAAA"
TABLE = "tblAAAAAAAA"


@pytest.fixture(autouse=True)
def _isolate(isolate):
    return isolate


def _ref(record_id="recAAAAAAAA", **extra):
    return {"base_id": BASE, "table_id": TABLE, "record_id": record_id, **extra}


def _refs(count):
    return [_ref(f"rec{i:08d}") for i in range(count)]


def _attach(client, workspace, project, issue, records):
    return client.post(records_url(workspace, project, issue), {"records": records}, format="json")


def _refresh(client, workspace, project, issue, payload=None):
    return client.post(records_url(workspace, project, issue, "refresh/"), payload or {}, format="json")


def _row(issue, **kwargs):
    return IssueCyberneticsRecordFactory(issue=issue, project=issue.project, **kwargs)


class TestList:
    def test_guest_sees_snapshots(self, make_member, workspace, project, issue, integration):
        row = _row(issue, record_name="ACME", preview={"Email": "a@acme.com"})
        response = make_member(GUEST).get(records_url(workspace, project, issue))
        assert response.status_code == status.HTTP_200_OK
        assert [r["id"] for r in response.data] == [str(row.id)]
        assert response.data[0]["record_name"] == "ACME"
        assert response.data[0]["preview"] == {"Email": "a@acme.com"}

    def test_deep_link_uses_current_base_url(self, session_client, workspace, project, issue, integration):
        row = _row(issue, source_url="https://old.example.com/stale")
        integration.base_url = "https://new.example.com"
        integration.save()
        response = session_client.get(records_url(workspace, project, issue))
        assert response.data[0]["deep_link"] == (
            f"https://new.example.com/base/{BASE}/table/{TABLE}?recordId={row.record_id}"
        )

    def test_deep_link_falls_back_after_disconnect(self, session_client, workspace, project, issue, integration):
        row = _row(issue, source_url="https://old.example.com/stale")
        assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT
        response = session_client.get(records_url(workspace, project, issue))
        assert response.status_code == status.HTTP_200_OK
        assert response.data[0]["deep_link"] == row.source_url

    def test_exclusions(self, session_client, workspace, project, other_project, issue, state, integration):
        kept = _row(issue)
        _row(IssueFactory(project=project, state=state))
        _row(IssueFactory(project=other_project))
        _row(issue).delete()
        response = session_client.get(records_url(workspace, project, issue))
        assert [r["id"] for r in response.data] == [str(kept.id)]

    def test_ordered_newest_first(self, session_client, workspace, project, issue, integration):
        old, new = _row(issue), _row(issue)
        IssueCyberneticsRecord.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=1))
        response = session_client.get(records_url(workspace, project, issue))
        assert [r["id"] for r in response.data] == [str(new.id), str(old.id)]

    def test_non_member(self, make_member, workspace, project, issue, integration):
        _row(issue)
        assert make_member(None).get(records_url(workspace, project, issue)).status_code == status.HTTP_403_FORBIDDEN


class TestCreate:
    def test_happy_path(self, session_client, workspace, project, issue, integration, fake_client, isolate):
        response = _attach(session_client, workspace, project, issue, [_ref(), _ref("recBBBBBBBB", view_id="viwAAAAAAAA")])
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["skipped"] == []
        created = response.data["created"]
        assert {r["record_id"] for r in created} == {"recAAAAAAAA", "recBBBBBBBB"}
        assert created[0]["record_name"] == "ACME"
        assert created[0]["preview"] == {"Email": "a@acme.com"}
        assert created[0]["deep_link"].startswith("https://data.example.com/base/")
        rows = IssueCyberneticsRecord.objects.filter(issue=issue)
        assert rows.count() == 2
        assert all(r.status == "ok" and r.snapshot_at is not None for r in rows)
        assert rows.get(record_id="recBBBBBBBB").view_id == "viwAAAAAAAA"
        assert isolate.call_count == 2
        assert {c.kwargs["type"] for c in isolate.call_args_list} == {"cybernetics_record.activity.created"}
        assert {json.loads(c.kwargs["requested_data"])["record_id"] for c in isolate.call_args_list} == {
            "recAAAAAAAA",
            "recBBBBBBBB",
        }

    def test_duplicates_are_skipped(self, session_client, workspace, project, issue, integration, fake_client, isolate):
        _row(issue, record_id="recAAAAAAAA")
        response = _attach(
            session_client, workspace, project, issue, [_ref(), _ref("recBBBBBBBB"), _ref("recBBBBBBBB")]
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert [r["record_id"] for r in response.data["created"]] == ["recBBBBBBBB"]
        assert response.data["skipped"] == [
            {"table_id": TABLE, "record_id": "recAAAAAAAA", "reason": "already_attached"},
            {"table_id": TABLE, "record_id": "recBBBBBBBB", "reason": "already_attached"},
        ]
        assert isolate.call_count == 1

    @pytest.mark.parametrize(
        "exc,code", [(CyberneticsNotFound("gone"), "CYBERNETICS_NOT_FOUND"), (CyberneticsForbidden("no"), "CYBERNETICS_FORBIDDEN")]
    )
    def test_upstream_failure_is_reported(self, session_client, workspace, project, issue, integration, fake_client, exc, code):
        fake_client.get_record.side_effect = exc
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_ATTACH_FAILED")
        assert response.data["failed"] == [{"record_id": "recAAAAAAAA", "table_id": TABLE, "error_message": code}]

    def test_mixed_result_creates_nothing(self, session_client, workspace, project, issue, integration, fake_client, isolate):
        ok = fake_client.get_record.return_value
        fake_client.get_record.side_effect = [ok, CyberneticsNotFound("gone")]
        response = _attach(session_client, workspace, project, issue, [_ref(), _ref("recBBBBBBBB")])
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_ATTACH_FAILED")
        assert [f["record_id"] for f in response.data["failed"]] == ["recBBBBBBBB"]
        assert not IssueCyberneticsRecord.all_objects.filter(issue=issue).exists()
        isolate.assert_not_called()

    @pytest.mark.parametrize("count,expected", [(0, 400), (10, 201), (11, 400)])
    def test_record_cap(self, session_client, workspace, project, issue, integration, fake_client, count, expected):
        response = _attach(session_client, workspace, project, issue, _refs(count))
        assert response.status_code == expected
        assert IssueCyberneticsRecord.objects.filter(issue=issue).count() == (count if expected == 201 else 0)

    def test_bad_id_format(self, session_client, workspace, project, issue, integration, fake_client):
        response = _attach(session_client, workspace, project, issue, [_ref("tblAAAAAAAA")])
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        fake_client.get_record.assert_not_called()

    def test_archived_issue(self, session_client, workspace, project, archived_issue, integration, fake_client):
        response = _attach(session_client, workspace, project, archived_issue, [_ref()])
        assert response.status_code == status.HTTP_404_NOT_FOUND
        fake_client.get_record.assert_not_called()

    def test_issue_from_other_project(self, session_client, workspace, project, other_project, integration, fake_client):
        foreign = IssueFactory(project=other_project)
        response = _attach(session_client, workspace, project, foreign, [_ref()])
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert not IssueCyberneticsRecord.objects.exists()

    def test_no_integration(self, session_client, workspace, project, issue):
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert_error(response, status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED")

    def test_disabled_integration(self, session_client, workspace, project, issue, integration):
        integration.is_enabled = False
        integration.save()
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert_error(response, status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED")

    def test_unreachable(self, session_client, workspace, project, issue, integration, fake_client):
        fake_client.get_record.side_effect = CyberneticsUnreachable("down")
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert_error(response, status.HTTP_502_BAD_GATEWAY, "CYBERNETICS_UNREACHABLE")
        assert not IssueCyberneticsRecord.objects.exists()

    def test_reattach_after_soft_delete(self, session_client, workspace, project, issue, integration, fake_client):
        _row(issue, record_id="recAAAAAAAA").delete()
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert response.status_code == status.HTTP_201_CREATED
        assert len(response.data["created"]) == 1
        assert IssueCyberneticsRecord.all_objects.filter(issue=issue, record_id="recAAAAAAAA").count() == 2

    def test_concurrent_duplicate(self, session_client, workspace, project, issue, integration, fake_client, mocker, isolate):
        mocker.patch.object(IssueCyberneticsRecord.objects, "create", side_effect=IntegrityError("duplicate"))
        response = _attach(session_client, workspace, project, issue, [_ref()])
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data == {
            "created": [],
            "skipped": [{"table_id": TABLE, "record_id": "recAAAAAAAA", "reason": "already_attached"}],
        }
        isolate.assert_not_called()

    def test_guest_cannot_attach(self, make_member, workspace, project, issue, integration, fake_client):
        response = _attach(make_member(GUEST), workspace, project, issue, [_ref()])
        assert response.status_code == status.HTTP_403_FORBIDDEN
        fake_client.get_record.assert_not_called()

    def test_member_can_attach(self, make_member, workspace, project, issue, integration, fake_client):
        response = _attach(make_member(MEMBER), workspace, project, issue, [_ref()])
        assert response.status_code == status.HTTP_201_CREATED


class TestDestroy:
    def _delete(self, client, workspace, project, issue, pk):
        return client.delete(records_url(workspace, project, issue, f"{pk}/"))

    def test_admin_removes_any_row(self, make_member, workspace, project, issue, integration, isolate):
        row = _row(issue)
        response = self._delete(make_member(ADMIN), workspace, project, issue, row.id)
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not IssueCyberneticsRecord.objects.filter(pk=row.pk).exists()

    def test_creator_member_removes_own_row(self, make_member, workspace, project, issue, integration):
        client = make_member(MEMBER)
        row = _row(issue, created_by=client.user)
        assert self._delete(client, workspace, project, issue, row.id).status_code == status.HTTP_204_NO_CONTENT

    def test_other_member_cannot(self, make_member, workspace, project, issue, integration):
        row = _row(issue)
        assert self._delete(make_member(MEMBER), workspace, project, issue, row.id).status_code == status.HTTP_403_FORBIDDEN
        assert IssueCyberneticsRecord.objects.filter(pk=row.pk).exists()

    def test_guest_cannot(self, make_member, workspace, project, issue, integration):
        row = _row(issue)
        assert self._delete(make_member(GUEST), workspace, project, issue, row.id).status_code == status.HTTP_403_FORBIDDEN

    def test_unknown_pk(self, session_client, workspace, project, issue, integration):
        assert self._delete(session_client, workspace, project, issue, uuid4()).status_code == status.HTTP_404_NOT_FOUND

    def test_pk_from_other_issue(self, session_client, workspace, project, issue, state, integration):
        other_row = _row(IssueFactory(project=project, state=state))
        response = self._delete(session_client, workspace, project, issue, other_row.id)
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert IssueCyberneticsRecord.objects.filter(pk=other_row.pk).exists()

    def test_archived_issue(self, session_client, workspace, project, archived_issue, integration):
        row = _row(archived_issue)
        response = self._delete(session_client, workspace, project, archived_issue, row.id)
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert IssueCyberneticsRecord.objects.filter(pk=row.pk).exists()

    def test_activity_and_soft_delete(self, session_client, workspace, project, issue, integration, isolate):
        row = _row(issue, table_name="Customers", record_name="ACME")
        assert self._delete(session_client, workspace, project, issue, row.id).status_code == status.HTTP_204_NO_CONTENT
        isolate.assert_called_once()
        kwargs = isolate.call_args.kwargs
        assert kwargs["type"] == "cybernetics_record.activity.deleted"
        assert json.loads(kwargs["requested_data"]) == {"id": str(row.id)}
        current = json.loads(kwargs["current_instance"])
        assert (current["id"], current["table_name"], current["record_name"]) == (str(row.id), "Customers", "ACME")
        assert IssueCyberneticsRecord.all_objects.get(pk=row.pk).deleted_at is not None


class TestRefresh:
    def test_ok_updates_snapshot_and_recovers_missing(self, session_client, workspace, project, issue, integration, fake_client):
        row = _row(issue, record_id="recAAAAAAAA", record_name="Old", status="missing")
        before = row.snapshot_at
        response = _refresh(session_client, workspace, project, issue)
        assert response.status_code == status.HTTP_200_OK
        assert response.data[0]["status"] == "ok"
        assert response.data[0]["record_name"] == "ACME"
        row.refresh_from_db()
        assert row.status == "ok"
        assert row.record_name == "ACME"
        assert row.preview == {"Email": "a@acme.com"}
        assert row.snapshot_at > before

    @pytest.mark.parametrize(
        "exc,expected", [(CyberneticsNotFound("gone"), "missing"), (CyberneticsForbidden("no"), "forbidden")]
    )
    def test_upstream_status(self, session_client, workspace, project, issue, integration, fake_client, exc, expected):
        row = _row(issue, record_name="Kept")
        fake_client.get_record.side_effect = exc
        response = _refresh(session_client, workspace, project, issue)
        assert response.status_code == status.HTTP_200_OK
        assert response.data[0]["status"] == expected
        row.refresh_from_db()
        assert row.status == expected
        assert row.record_name == "Kept"

    @pytest.mark.parametrize("ids", ["not-a-list", 5, [str(uuid4()) for _ in range(11)]])
    def test_invalid_ids(self, session_client, workspace, project, issue, integration, fake_client, ids):
        response = _refresh(session_client, workspace, project, issue, {"ids": ids})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.get_record.assert_not_called()

    def test_ids_limit_rows(self, session_client, workspace, project, issue, integration, fake_client):
        chosen, other = _row(issue, record_id="recCHOSEN01"), _row(issue, record_id="recOTHER001")
        response = _refresh(session_client, workspace, project, issue, {"ids": [str(chosen.id)]})
        assert response.status_code == status.HTTP_200_OK
        assert [c.args[1] for c in fake_client.get_record.call_args_list] == ["recCHOSEN01"]
        # The response lists every row of the issue.
        assert {r["id"] for r in response.data} == {str(chosen.id), str(other.id)}

    def test_without_ids_at_most_ten_rows(self, session_client, workspace, project, issue, integration, fake_client):
        for _ in range(11):
            _row(issue)
        assert _refresh(session_client, workspace, project, issue).status_code == status.HTTP_200_OK
        assert fake_client.get_record.call_count == 10

    def test_invalid_uuid(self, session_client, workspace, project, issue, integration, fake_client):
        _row(issue)
        response = _refresh(session_client, workspace, project, issue, {"ids": ["not-a-uuid"]})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        fake_client.get_record.assert_not_called()

    def test_unreachable_part_way(self, session_client, workspace, project, issue, integration, fake_client):
        _row(issue)
        _row(issue)
        fake_client.get_record.side_effect = [fake_client.get_record.return_value, CyberneticsUnreachable("down")]
        response = _refresh(session_client, workspace, project, issue)
        assert_error(response, status.HTTP_502_BAD_GATEWAY, "CYBERNETICS_UNREACHABLE")

    def test_guest_cannot(self, make_member, workspace, project, issue, integration, fake_client):
        _row(issue)
        assert _refresh(make_member(GUEST), workspace, project, issue).status_code == status.HTTP_403_FORBIDDEN
        fake_client.get_record.assert_not_called()

    def test_archived_issue(self, session_client, workspace, project, archived_issue, integration, fake_client):
        _row(archived_issue)
        assert _refresh(session_client, workspace, project, archived_issue).status_code == status.HTTP_404_NOT_FOUND
        fake_client.get_record.assert_not_called()


class TestThrottling:
    @pytest.fixture
    def throttled(self, mocker):
        mocker.patch.object(CyberneticsDataProxyThrottle, "allow_request", return_value=False)
        mocker.patch.object(CyberneticsDataProxyThrottle, "wait", return_value=None)

    def test_post_is_throttled(self, session_client, workspace, project, issue, integration, fake_client, throttled):
        assert_error(
            _attach(session_client, workspace, project, issue, [_ref()]),
            status.HTTP_429_TOO_MANY_REQUESTS,
            "CYBERNETICS_RATE_LIMITED",
        )
        assert_error(
            _refresh(session_client, workspace, project, issue),
            status.HTTP_429_TOO_MANY_REQUESTS,
            "CYBERNETICS_RATE_LIMITED",
        )
        fake_client.get_record.assert_not_called()

    def test_get_and_delete_are_not(self, session_client, workspace, project, issue, integration, throttled):
        row = _row(issue)
        assert session_client.get(records_url(workspace, project, issue)).status_code == status.HTTP_200_OK
        response = session_client.delete(records_url(workspace, project, issue, f"{row.id}/"))
        assert response.status_code == status.HTTP_204_NO_CONTENT
