# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from urllib.parse import urlencode

import pytest
from rest_framework import status

from plane.db.models import ProjectCyberneticsDataIntegration
from plane.tests.contract.app.conftest_cybernetics import (
    ADMIN,
    GUEST,
    MEMBER,
    assert_error,
    config_url,
)
from plane.tests.factories import (
    ProjectCyberneticsDataIntegrationFactory,
    WorkspaceFactory,
    WorkspaceMemberFactory,
)
from plane.utils.cybernetics_data import service
from plane.utils.cybernetics_data.client import (
    CyberneticsBadRequest,
    CyberneticsDataError,
    CyberneticsForbidden,
    CyberneticsNotFound,
    CyberneticsRateLimited,
    CyberneticsUnauthorized,
    CyberneticsUnreachable,
)

pytest_plugins = ["plane.tests.contract.app.conftest_cybernetics"]
pytestmark = [pytest.mark.contract, pytest.mark.django_db]

BASE = "bseAAAAAAAA"
TABLE = "tblAAAAAAAA"
RECORD = "recAAAAAAAA"
FILTER = {"conjunction": "and", "filterSet": [{"fieldId": "fldEMAIL0001", "operator": "contains", "value": "acme"}]}
ORDER = [{"field_id": "fldEMAIL0001", "order": "desc"}]


@pytest.fixture(autouse=True)
def _isolate(isolate):
    return isolate


def _databases(workspace, project):
    return config_url(workspace, project, "databases/")


def _tables(workspace, project, base_id=BASE):
    return config_url(workspace, project, f"bases/{base_id}/tables/")


def _schema(workspace, project, table_id=TABLE, **params):
    return config_url(workspace, project, f"tables/{table_id}/schema/") + _qs(params)


def _records(workspace, project, table_id=TABLE, **params):
    return config_url(workspace, project, f"tables/{table_id}/records/") + _qs(params)


def _record(workspace, project, table_id=TABLE, record_id=RECORD, **params):
    return config_url(workspace, project, f"tables/{table_id}/records/{record_id}/") + _qs(params)


def _qs(params):
    return f"?{urlencode(params)}" if params else ""


def _all_urls(workspace, project):
    return [
        _databases(workspace, project),
        _tables(workspace, project),
        _schema(workspace, project, base_id=BASE),
        _records(workspace, project, base_id=BASE),
        _record(workspace, project, base_id=BASE),
    ]


class TestRoleMatrix:
    @pytest.mark.parametrize("role", [ADMIN, MEMBER])
    def test_admin_and_member_can_browse(self, make_member, workspace, project, integration, fake_client, role):
        client = make_member(role)
        for url in _all_urls(workspace, project):
            assert client.get(url).status_code == status.HTTP_200_OK, url

    @pytest.mark.parametrize("role", [GUEST, None])
    def test_guest_and_non_member_cannot(self, make_member, workspace, project, integration, fake_client, role):
        client = make_member(role)
        for url in _all_urls(workspace, project):
            assert client.get(url).status_code == status.HTTP_403_FORBIDDEN, url
        fake_client.list_bases.assert_not_called()
        fake_client.get_record.assert_not_called()

    def test_unauthenticated(self, api_client, workspace, project, integration, fake_client):
        response = api_client.get(_databases(workspace, project))
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


class TestConfigurationStates:
    # No fake_client here: the real client_for decides, and no request is made.
    def test_not_configured(self, session_client, workspace, project):
        assert_error(
            session_client.get(_databases(workspace, project)), status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED"
        )

    def test_disabled(self, session_client, workspace, project, integration):
        integration.is_enabled = False
        integration.save()
        assert_error(
            session_client.get(_databases(workspace, project)), status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED"
        )

    def test_instance_flag_off(self, session_client, workspace, project, integration, settings):
        settings.CYBERNETICS_DATA_ENABLED = False
        assert_error(
            session_client.get(_databases(workspace, project)), status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED"
        )

    def test_unreadable_token(self, session_client, workspace, project, integration):
        ProjectCyberneticsDataIntegration.objects.filter(pk=integration.pk).update(api_token_encrypted="garbage")
        assert_error(
            session_client.get(_databases(workspace, project)), status.HTTP_409_CONFLICT, "CYBERNETICS_TOKEN_UNREADABLE"
        )

    def test_disconnected(self, session_client, workspace, project, integration):
        assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT
        assert_error(
            session_client.get(_databases(workspace, project)), status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_CONFIGURED"
        )


class TestUpstreamErrors:
    @pytest.mark.parametrize(
        "exc,status_code,error_message",
        [
            (CyberneticsUnauthorized("token revoked"), 424, "CYBERNETICS_UNAUTHORIZED"),
            (CyberneticsForbidden("no scope"), 403, "CYBERNETICS_FORBIDDEN"),
            (CyberneticsNotFound("gone"), 404, "CYBERNETICS_NOT_FOUND"),
            (CyberneticsBadRequest("bad"), 400, "CYBERNETICS_BAD_REQUEST"),
            (CyberneticsRateLimited("slow"), 429, "CYBERNETICS_RATE_LIMITED"),
            (CyberneticsUnreachable("down"), 502, "CYBERNETICS_UNREACHABLE"),
            (CyberneticsDataError("boom"), 502, "CYBERNETICS_ERROR"),
        ],
    )
    def test_error_mapping(self, session_client, workspace, project, integration, fake_client, exc, status_code, error_message):
        fake_client.list_bases.side_effect = exc
        response = session_client.get(_databases(workspace, project))
        assert_error(response, status_code, error_message)
        assert response.data["error"] == exc.message

    def test_upstream_401_is_not_401(self, session_client, workspace, project, integration, fake_client):
        fake_client.list_records.side_effect = CyberneticsUnauthorized("token revoked")
        response = session_client.get(_records(workspace, project, base_id=BASE))
        assert response.status_code == status.HTTP_424_FAILED_DEPENDENCY


class TestIsolation:
    def test_other_project_does_not_see_integration(
        self, session_client, workspace, project, other_project, integration, fake_client
    ):
        # fake_client replaces client_for, so only the integration lookup can fail here.
        assert_error(
            session_client.get(_databases(workspace, other_project)),
            status.HTTP_404_NOT_FOUND,
            "CYBERNETICS_NOT_CONFIGURED",
        )
        fake_client.list_bases.assert_not_called()

    def test_other_workspace_slug(self, session_client, create_user, workspace, project, integration, fake_client):
        other = WorkspaceFactory(owner=create_user, slug="other-workspace")
        WorkspaceMemberFactory(workspace=other, member=create_user, role=ADMIN)
        url = f"/api/workspaces/{other.slug}/projects/{project.id}/cybernetics-data/databases/"
        assert session_client.get(url).status_code == status.HTTP_403_FORBIDDEN
        fake_client.list_bases.assert_not_called()

    def test_each_project_uses_its_own_integration(
        self, session_client, workspace, project, other_project, integration, fake_client
    ):
        other_integration = ProjectCyberneticsDataIntegrationFactory(
            project=other_project, base_url="https://other.example.com", token="cybernetics_other_token_000001"
        )
        session_client.get(_databases(workspace, other_project))
        # service.client_for is the fake_client patch.
        assert service.client_for.call_args.args[0].pk == other_integration.pk


class TestDatabasesAndTables:
    def test_databases(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_databases(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == [
            {
                "space": {"id": "spcAAAAAAAA", "name": "Marketing"},
                "bases": [{"id": "bseAAAAAAAA", "name": "CRM", "icon": None}],
            }
        ]

    def test_tables(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_tables(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == [
            {"id": TABLE, "name": "Customers", "icon": None, "description": "", "default_view_id": ""}
        ]
        fake_client.list_tables.assert_called_once_with(BASE)

    @pytest.mark.parametrize("base_id", ["tblAAAAAAAA", "bseshort", "bseAAAA-AAAA", "bse..AAAAAAAA"])
    def test_tables_invalid_base_id(self, session_client, workspace, project, integration, fake_client, base_id):
        response = session_client.get(_tables(workspace, project, base_id))
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.list_tables.assert_not_called()


class TestSchema:
    def test_base_id_required(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_schema(workspace, project))
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        assert response.data["error"] == "base_id is required"

    @pytest.mark.parametrize(
        "params",
        [{"base_id": "tblAAAAAAAA"}, {"base_id": BASE, "view_id": "fldAAAAAAAA"}],
    )
    def test_invalid_ids(self, session_client, workspace, project, integration, fake_client, params):
        assert_error(
            session_client.get(_schema(workspace, project, **params)),
            status.HTTP_400_BAD_REQUEST,
            "CYBERNETICS_BAD_REQUEST",
        )
        fake_client.list_fields.assert_not_called()

    def test_invalid_table_id(self, session_client, workspace, project, integration, fake_client):
        assert_error(
            session_client.get(_schema(workspace, project, table_id="recAAAAAAAA", base_id=BASE)),
            status.HTTP_400_BAD_REQUEST,
            "CYBERNETICS_BAD_REQUEST",
        )

    def test_view_id_forwarded(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_schema(workspace, project, base_id=BASE, view_id="viwAAAAAAAA"))
        assert response.status_code == status.HTTP_200_OK
        assert [f["id"] for f in response.data["fields"]] == ["fldPRIMARY01", "fldEMAIL0001"]
        assert response.data["views"] == []
        fake_client.get_table.assert_called_once_with(BASE, TABLE)
        fake_client.list_fields.assert_called_once_with(TABLE, "viwAAAAAAAA")


class TestRecords:
    @pytest.mark.parametrize(
        "table_id,params",
        [
            ("bseAAAAAAAA", {"base_id": BASE}),
            (TABLE, {}),
            (TABLE, {"base_id": "tblAAAAAAAA"}),
            (TABLE, {"base_id": BASE, "view_id": "viw"}),
            (TABLE, {"base_id": BASE, "search_field": "recAAAAAAAA"}),
            (TABLE, {"base_id": BASE, "take": "abc"}),
            (TABLE, {"base_id": BASE, "skip": "1.5"}),
            (TABLE, {"base_id": BASE, "search": "x" * 201}),
            (TABLE, {"base_id": BASE, "filter": "{not json"}),
            (TABLE, {"base_id": BASE, "filter": json.dumps({"filterSet": [{"fieldId": "fldAAAAAAAA", "operator": "x"}]})}),
            (TABLE, {"base_id": BASE, "order_by": "[{"}),
            (TABLE, {"base_id": BASE, "order_by": json.dumps([{"field_id": "fldAAAAAAAA", "order": "up"}])}),
        ],
    )
    def test_invalid_params(self, session_client, workspace, project, integration, fake_client, table_id, params):
        response = session_client.get(_records(workspace, project, table_id, **params))
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.list_records.assert_not_called()

    def test_defaults(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_records(workspace, project, base_id=BASE))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"records": [], "take": 50, "skip": 0}
        kwargs = fake_client.list_records.call_args.kwargs
        assert (kwargs["take"], kwargs["skip"], kwargs["view_id"], kwargs["search"]) == (50, 0, None, None)
        assert kwargs["filter_"] is None and kwargs["order_by"] is None
        assert kwargs["projection"] == ["fldPRIMARY01", "fldEMAIL0001"]
        assert kwargs["cell_format"] == "text"
        fake_client.row_count.assert_not_called()

    @pytest.mark.parametrize(
        "take,skip,expected",
        [("0", "-5", (1, 0)), ("500", "20", (200, 20)), ("25", "", (25, 0)), ("", "99999999999", (50, 10_000_000))],
    )
    def test_take_and_skip_are_clamped(self, session_client, workspace, project, integration, fake_client, take, skip, expected):
        response = session_client.get(_records(workspace, project, base_id=BASE, take=take, skip=skip))
        assert response.status_code == status.HTTP_200_OK
        kwargs = fake_client.list_records.call_args.kwargs
        assert (kwargs["take"], kwargs["skip"]) == expected
        assert (response.data["take"], response.data["skip"]) == expected

    def test_search_filter_order_passed_through(self, session_client, workspace, project, integration, fake_client):
        fake_client.list_records.return_value = {"records": [{"id": RECORD, "name": "ACME", "fields": {"f": 1}}]}
        response = session_client.get(
            _records(
                workspace,
                project,
                base_id=BASE,
                view_id="viwAAAAAAAA",
                search="  acme ",
                search_field="fldEMAIL0001",
                filter=json.dumps(FILTER),
                order_by=json.dumps(ORDER),
            )
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["records"][0]["id"] == RECORD
        assert response.data["records"][0]["fields"] == {"f": 1}
        kwargs = fake_client.list_records.call_args.kwargs
        assert kwargs["view_id"] == "viwAAAAAAAA"
        assert kwargs["search"] == "acme"
        assert kwargs["search_field"] == "fldEMAIL0001"
        assert kwargs["filter_"] == FILTER
        assert kwargs["order_by"] == [{"fieldId": "fldEMAIL0001", "order": "desc"}]

    def test_search_of_200_characters(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_records(workspace, project, base_id=BASE, search="x" * 200))
        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "Yes"])
    def test_with_total_truthy(self, session_client, workspace, project, integration, fake_client, value):
        fake_client.row_count.return_value = 12
        response = session_client.get(_records(workspace, project, base_id=BASE, with_total=value))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["total"] == 12

    @pytest.mark.parametrize("value", ["0", "false", "no", "maybe", ""])
    def test_with_total_falsy(self, session_client, workspace, project, integration, fake_client, value):
        response = session_client.get(_records(workspace, project, base_id=BASE, with_total=value))
        assert response.status_code == status.HTTP_200_OK
        assert "total" not in response.data
        fake_client.row_count.assert_not_called()


class TestRecordDetail:
    def test_invalid_cell_format(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_record(workspace, project, base_id=BASE, cell_format="html"))
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.get_record.assert_not_called()

    @pytest.mark.parametrize(
        "table_id,record_id,params",
        [
            ("recAAAAAAAA", RECORD, {"base_id": BASE}),
            (TABLE, "tblAAAAAAAA", {"base_id": BASE}),
            (TABLE, RECORD, {}),
            (TABLE, RECORD, {"base_id": "bse"}),
        ],
    )
    def test_invalid_ids(self, session_client, workspace, project, integration, fake_client, table_id, record_id, params):
        response = session_client.get(_record(workspace, project, table_id, record_id, **params))
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.get_record.assert_not_called()

    def test_default_cell_format_is_json(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_record(workspace, project, base_id=BASE))
        assert response.status_code == status.HTTP_200_OK
        fake_client.get_record.assert_called_once_with(TABLE, RECORD, cell_format="json")

    def test_text_cell_format_and_deep_link(self, session_client, workspace, project, integration, fake_client):
        response = session_client.get(_record(workspace, project, base_id=BASE, cell_format="text"))
        assert response.status_code == status.HTTP_200_OK
        fake_client.get_record.assert_called_once_with(TABLE, RECORD, cell_format="text")
        assert response.data["record"]["name"] == "ACME"
        assert [f["id"] for f in response.data["fields"]] == ["fldPRIMARY01", "fldEMAIL0001"]
        assert response.data["deep_link"] == f"https://data.example.com/base/{BASE}/table/{TABLE}?recordId={RECORD}"

    def test_table_must_belong_to_base(self, session_client, workspace, project, integration, fake_client):
        fake_client.get_table.side_effect = CyberneticsNotFound("table not in base")
        response = session_client.get(_record(workspace, project, base_id=BASE))
        assert_error(response, status.HTTP_404_NOT_FOUND, "CYBERNETICS_NOT_FOUND")
        fake_client.get_record.assert_not_called()
