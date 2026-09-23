# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""End to end through the real client, service and views; only ``pinned_fetch`` is faked."""

import json

import pytest
from rest_framework import status

from plane.db.models import IssueCyberneticsRecord, ProjectCyberneticsDataIntegration
from plane.tests.contract.app.conftest_cybernetics import TOKEN, config_url, records_url
from plane.tests.unit.cybernetics_data.fakes import FakeTeable

pytest_plugins = ["plane.tests.contract.app.conftest_cybernetics"]
pytestmark = [pytest.mark.contract, pytest.mark.django_db]

T = FakeTeable


@pytest.fixture(autouse=True)
def _isolate(isolate):
    return isolate


@pytest.fixture
def teable(mocker):
    fake = FakeTeable()
    mocker.patch("plane.utils.cybernetics_data.client.pinned_fetch", side_effect=fake)
    return fake


def _query(call):
    return call["query"]


def test_full_flow(session_client, workspace, project, issue, teable, isolate):
    # 1. configure
    response = session_client.put(
        config_url(workspace, project), {"base_url": "https://data.example.com/api/", "api_token": TOKEN}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    assert response.data["last_verified_status"] == "ok"
    assert TOKEN not in json.dumps(response.data, default=str)
    assert teable.paths() == ["/base/access/all", f"/base/{T.BASE_ID}/table", f"/table/{T.TABLE_ID}/record"]
    assert ("take", "1") in teable.calls[-1]["query"]

    # 2. browse: databases, tables, records with search / filter / order
    response = session_client.get(config_url(workspace, project, "databases/"))
    assert response.status_code == status.HTTP_200_OK
    assert response.data == [
        {"space": {"id": T.SPACE_ID, "name": "Marketing"}, "bases": [{"id": T.BASE_ID, "name": "CRM", "icon": None}]},
        {"space": {"id": "", "name": ""}, "bases": [{"id": T.OTHER_BASE_ID, "name": "Ledger", "icon": None}]},
    ]

    response = session_client.get(config_url(workspace, project, f"bases/{T.BASE_ID}/tables/"))
    assert response.status_code == status.HTTP_200_OK
    assert [t["id"] for t in response.data] == [T.TABLE_ID]
    assert response.data[0]["default_view_id"] == T.VIEW_ID

    flt = {"conjunction": "and", "filterSet": [{"fieldId": T.EMAIL_FIELD, "operator": "contains", "value": "acme"}]}
    order = [{"field_id": T.EMAIL_FIELD, "order": "desc"}]
    response = session_client.get(
        config_url(workspace, project, f"tables/{T.TABLE_ID}/records/"),
        {
            "base_id": T.BASE_ID,
            "search": "acme",
            "search_field": T.PRIMARY_FIELD,
            "filter": json.dumps(flt),
            "order_by": json.dumps(order),
            "take": "10",
            "with_total": "true",
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert [r["id"] for r in response.data["records"]] == [T.RECORD_A, T.RECORD_B]
    assert response.data["total"] == 2

    records_call = teable.calls_to(f"/table/{T.TABLE_ID}/record")[-1]
    query = _query(records_call)
    assert ("fieldKeyType", "id") in query
    assert [v for k, v in query if k == "search[]"] == ["acme", T.PRIMARY_FIELD, "true"]
    assert dict(query)["filter"] == json.dumps(flt, separators=(",", ":"))
    assert dict(query)["orderBy"] == json.dumps([{"fieldId": T.EMAIL_FIELD, "order": "desc"}], separators=(",", ":"))
    assert [v for k, v in query if k == "projection[]"] == [T.PRIMARY_FIELD, T.EMAIL_FIELD, T.FILES_FIELD]
    assert ("take", "10") in query and ("cellFormat", "text") in query
    count_query = _query(teable.calls_to(f"/table/{T.TABLE_ID}/aggregation/row-count")[-1])
    assert [v for k, v in count_query if k == "search[]"] == ["acme", T.PRIMARY_FIELD, "true"]
    # table ownership was checked through the base
    assert teable.calls_to(f"/base/{T.BASE_ID}/table/{T.TABLE_ID}")

    # 3. attach two records
    refs = [
        {"base_id": T.BASE_ID, "table_id": T.TABLE_ID, "record_id": T.RECORD_A},
        {"base_id": T.BASE_ID, "table_id": T.TABLE_ID, "record_id": T.RECORD_B, "view_id": T.VIEW_ID},
    ]
    response = session_client.post(records_url(workspace, project, issue), {"records": refs}, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.data
    created = {r["record_id"]: r for r in response.data["created"]}
    assert created[T.RECORD_A]["record_name"] == "ACME"
    assert created[T.RECORD_A]["base_name"] == "CRM"
    assert created[T.RECORD_A]["table_name"] == "Customers"
    assert created[T.RECORD_A]["space_id"] == T.SPACE_ID
    # attachment fields never reach the preview
    assert created[T.RECORD_A]["preview"] == {"Email": "a@acme"}
    snapshot_query = _query(teable.calls_to(f"/table/{T.TABLE_ID}/record/{T.RECORD_A}")[-1])
    assert ("cellFormat", "text") in snapshot_query
    assert [v for k, v in snapshot_query if k == "projection[]"] == [T.PRIMARY_FIELD, T.EMAIL_FIELD]
    assert isolate.call_count == 2

    # 4. list
    response = session_client.get(records_url(workspace, project, issue))
    assert response.status_code == status.HTTP_200_OK
    assert {r["record_id"] for r in response.data} == {T.RECORD_A, T.RECORD_B}
    assert all(r["deep_link"].startswith("https://data.example.com/base/") for r in response.data)

    # 5. the record disappears upstream; refresh marks it missing
    del teable.records[T.TABLE_ID][T.RECORD_B]
    response = session_client.post(records_url(workspace, project, issue, "refresh/"), {}, format="json")
    assert response.status_code == status.HTTP_200_OK
    assert {r["record_id"]: r["status"] for r in response.data} == {T.RECORD_A: "ok", T.RECORD_B: "missing"}

    # 6. remove
    row_b = created[T.RECORD_B]["id"]
    response = session_client.delete(records_url(workspace, project, issue, f"{row_b}/"))
    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert [r["record_id"] for r in session_client.get(records_url(workspace, project, issue)).data] == [T.RECORD_A]

    # 7. disconnect
    assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT
    row = ProjectCyberneticsDataIntegration.all_objects.get(project=project)
    assert (row.api_token_encrypted, row.token_hint, row.token_fingerprint) == ("", "", "")
    response = session_client.get(config_url(workspace, project, "databases/"))
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert IssueCyberneticsRecord.objects.filter(issue=issue).count() == 1

    # The Bearer token only ever went to the configured host, always over the pinned, streamed transport.
    assert teable.calls
    for call in teable.calls:
        assert call["host"] == "data.example.com"
        assert call["headers"]["Authorization"] == f"Bearer {TOKEN}"
        assert call["method"] == "GET"
        assert call["stream"] is True


def test_url_change_sends_new_token_only_to_new_host(session_client, workspace, project, integration, teable):
    new_token = "cybernetics_new_token_for_other_host"
    response = session_client.put(
        config_url(workspace, project), {"base_url": "https://other.example.com", "api_token": new_token}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK
    assert teable.calls
    for call in teable.calls:
        assert call["host"] == "other.example.com"
        assert call["headers"]["Authorization"] == f"Bearer {new_token}"


def test_upstream_401_during_browse(session_client, workspace, project, integration, teable):
    teable.errors["/base/access/all"] = 401
    response = session_client.get(config_url(workspace, project, "databases/"))
    assert response.status_code == status.HTTP_424_FAILED_DEPENDENCY
    assert response.data["error_message"] == "CYBERNETICS_UNAUTHORIZED"
    assert response.data["error"] == "fake error 401"
