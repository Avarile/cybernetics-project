# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from plane.tests.unit.cybernetics_data.fakes import DictCache
from plane.utils.cybernetics_data import service
from plane.utils.cybernetics_data.client import (
    CyberneticsBadRequest,
    CyberneticsDataClient,
    CyberneticsDataError,
    CyberneticsForbidden,
    CyberneticsNotFound,
    CyberneticsRateLimited,
    CyberneticsUnauthorized,
    CyberneticsUnreachable,
)
from plane.utils.cybernetics_data.secrets import encrypt_token

TOKEN = "cybernetics_service_token_0001"

FIELDS = [
    {"id": "fldPRIMARY01", "name": "Name", "type": "singleLineText", "isPrimary": True, "cellValueType": "string"},
    {"id": "fldEMAIL0001", "name": "Email", "type": "singleLineText", "cellValueType": "string"},
    {"id": "fldFILES0001", "name": "Files", "type": "attachment", "cellValueType": "string"},
    {
        "id": "fldSTATUS001",
        "name": "Status",
        "type": "singleSelect",
        "cellValueType": "string",
        "options": {"choices": [{"id": "cho1", "name": "Active", "color": "green"}]},
    },
]


@pytest.fixture(autouse=True)
def fake_cache(monkeypatch):
    cache = DictCache()
    monkeypatch.setattr(service, "cache", cache)
    return cache


@pytest.fixture
def integration():
    return SimpleNamespace(base_url="https://data.example.com", token_fingerprint="f" * 64, project_id="p1")


@pytest.fixture
def client():
    mock = MagicMock()
    mock.list_bases.return_value = [
        {"id": "bseAAAAAAAA", "name": "CRM", "spaceId": "spcAAAAAAAA", "icon": None},
        {"id": "bseBBBBBBBB", "name": "Ledger", "spaceId": "spcBBBBBBBB", "icon": "💰"},
        {"id": "bseCCCCCCCC", "name": "Stock", "spaceId": "spcAAAAAAAA", "icon": None},
    ]
    mock.list_spaces.return_value = [{"id": "spcAAAAAAAA", "name": "Marketing"}]
    mock.list_tables.return_value = [{"id": "tblAAAAAAAA", "name": "Customers"}]
    mock.get_table.return_value = {"id": "tblAAAAAAAA", "name": "Customers"}
    mock.get_base.return_value = {"id": "bseAAAAAAAA", "name": "CRM", "spaceId": "spcAAAAAAAA"}
    mock.list_fields.return_value = FIELDS
    mock.list_views.return_value = [{"id": "viwAAAAAAAA", "name": "Grid", "type": "grid", "filter": {}}]
    mock.list_records.return_value = {"records": []}
    mock.get_record.return_value = {"id": "recAAAAAAAA", "name": "ACME", "fields": {}}
    return mock


def _records_kwargs(**overrides):
    kwargs = dict(
        take=50,
        skip=0,
        view_id=None,
        search=None,
        search_field=None,
        filter_=None,
        order_by=None,
        with_total=False,
    )
    kwargs.update(overrides)
    return kwargs


@pytest.mark.unit
class TestClientFor:
    def _integration(self, **overrides):
        values = dict(is_enabled=True, api_token_encrypted=encrypt_token(TOKEN), base_url="https://data.example.com")
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_happy_path(self, settings):
        settings.CYBERNETICS_DATA_ENABLED = True
        client = service.client_for(self._integration())
        assert isinstance(client, CyberneticsDataClient)
        assert client.base_url == "https://data.example.com"
        assert client._token == TOKEN

    def test_disabled_integration(self, settings):
        settings.CYBERNETICS_DATA_ENABLED = True
        with pytest.raises(service.IntegrationNotConfigured):
            service.client_for(self._integration(is_enabled=False))

    def test_instance_flag_off(self, settings):
        settings.CYBERNETICS_DATA_ENABLED = False
        with pytest.raises(service.IntegrationNotConfigured):
            service.client_for(self._integration())

    def test_unreadable_token(self, settings):
        settings.CYBERNETICS_DATA_ENABLED = True
        with pytest.raises(service.TokenUnreadable):
            service.client_for(self._integration(api_token_encrypted="garbage"))

    def test_error_classes(self):
        assert (service.IntegrationNotConfigured.http_status, service.IntegrationNotConfigured.code) == (
            404,
            "CYBERNETICS_NOT_CONFIGURED",
        )
        assert (service.TokenUnreadable.http_status, service.TokenUnreadable.code) == (
            409,
            "CYBERNETICS_TOKEN_UNREADABLE",
        )


@pytest.mark.unit
class TestVerifyConnection:
    def test_ok(self, client):
        result = service.verify_connection(client)
        assert result == {"status": "ok", "message": "", "bases_visible": 3}
        client.list_tables.assert_called_once_with("bseAAAAAAAA")
        client.list_records.assert_called_once_with("tblAAAAAAAA", take=1)

    def test_no_bases(self, client):
        client.list_bases.return_value = []
        assert service.verify_connection(client) == {"status": "ok", "message": "", "bases_visible": 0}
        client.list_tables.assert_not_called()

    def test_bases_without_tables(self, client):
        client.list_tables.return_value = []
        assert service.verify_connection(client)["status"] == "ok"
        client.list_records.assert_not_called()

    def test_unauthorized(self, client):
        client.list_bases.side_effect = CyberneticsUnauthorized("bad token")
        assert service.verify_connection(client) == {
            "status": "unauthorized",
            "message": "bad token",
            "bases_visible": 0,
        }

    def test_forbidden_after_bases(self, client):
        client.list_records.side_effect = CyberneticsForbidden("no record scope")
        assert service.verify_connection(client) == {
            "status": "forbidden",
            "message": "The token is missing a read scope: no record scope",
            "bases_visible": 3,
        }

    def test_forbidden_on_bases(self, client):
        client.list_bases.side_effect = CyberneticsForbidden("no base scope")
        result = service.verify_connection(client)
        assert result["status"] == "forbidden"
        assert result["bases_visible"] == 0

    def test_unreachable(self, client):
        client.list_tables.side_effect = CyberneticsUnreachable("down")
        assert service.verify_connection(client) == {"status": "unreachable", "message": "down", "bases_visible": 0}

    @pytest.mark.parametrize(
        "exc",
        [
            CyberneticsNotFound("gone"),
            CyberneticsBadRequest("bad"),
            CyberneticsRateLimited("slow down"),
            CyberneticsDataError("boom"),
        ],
    )
    def test_other_errors(self, client, exc):
        client.list_tables.side_effect = exc
        assert service.verify_connection(client) == {"status": "error", "message": exc.message, "bases_visible": 0}


@pytest.mark.unit
class TestCache:
    def test_hit_skips_loader(self, integration, client, fake_cache):
        key = service._cache_key(integration, "databases")
        fake_cache.set(key, [{"cached": True}])
        assert service.list_databases(integration, client) == [{"cached": True}]
        client.list_bases.assert_not_called()

    def test_second_call_is_cached(self, integration, client):
        first = service.list_databases(integration, client)
        assert service.list_databases(integration, client) == first
        assert client.list_bases.call_count == 1

    def test_key_changes_with_token_fingerprint(self, integration):
        before = service._cache_key(integration, "databases")
        integration.token_fingerprint = "e" * 64
        assert service._cache_key(integration, "databases") != before

    def test_key_changes_with_base_url(self, integration):
        before = service._cache_key(integration, "databases")
        integration.base_url = "https://other.example.com"
        assert service._cache_key(integration, "databases") != before

    def test_key_is_per_project(self, integration):
        other = SimpleNamespace(**{**vars(integration), "project_id": "p2"})
        assert service._cache_key(integration, "tables", "bseA") != service._cache_key(other, "tables", "bseA")
        assert service._cache_key(integration, "tables", "bseA").startswith("cyb:p1:")

    def test_key_never_contains_secrets(self, integration):
        assert integration.token_fingerprint not in service._cache_key(integration, "databases")

    @pytest.mark.parametrize("kind", sorted(service.CACHE_TTL))
    def test_ttl(self, integration, fake_cache, kind):
        service._cached(integration, kind, ("x",), lambda: ["value"])
        assert fake_cache.timeouts[service._cache_key(integration, kind, "x")] == service.CACHE_TTL[kind]

    def test_ttl_values(self):
        assert service.CACHE_TTL == {"databases": 60, "tables": 60, "table": 300, "schema": 120, "base": 300}

    def test_empty_list_is_cached(self, integration):
        loader = MagicMock(return_value=[])
        service._cached(integration, "tables", ("bseA",), loader)
        service._cached(integration, "tables", ("bseA",), loader)
        assert loader.call_count == 1

    def test_none_is_not_cached(self, integration):
        loader = MagicMock(return_value=None)
        service._cached(integration, "table", ("bseA", "tblB"), loader)
        service._cached(integration, "table", ("bseA", "tblB"), loader)
        assert loader.call_count == 2


@pytest.mark.unit
class TestShaping:
    def test_shape_field(self):
        field = {
            "id": "fldAAAAAAAA",
            "name": "Company",
            "type": "link",
            "isPrimary": 1,
            "isLookup": None,
            "cellValueType": "string",
            "isMultipleCellValue": "yes",
            "options": {
                "choices": [{"id": f"c{i}", "name": f"n{i}", "color": "red"} for i in range(150)],
                "foreignTableId": "tblBBBBBBBB",
                "formatting": {"precision": 2},
                "secret": "ignored",
            },
        }
        shaped = service._shape_field(field)
        assert shaped["id"] == "fldAAAAAAAA"
        assert shaped["is_primary"] is True
        assert shaped["is_lookup"] is False
        assert shaped["is_multiple"] is True
        assert shaped["cell_value_type"] == "string"
        lite = shaped["options_lite"]
        assert set(lite) == {"choices", "foreign_table_id", "formatting"}
        assert len(lite["choices"]) == 100
        assert lite["choices"][0] == {"name": "n0", "color": "red"}
        assert lite["foreign_table_id"] == "tblBBBBBBBB"
        assert lite["formatting"] == {"precision": 2}

    def test_shape_field_without_options(self):
        shaped = service._shape_field({"id": "fldAAAAAAAA", "options": None})
        assert shaped == {
            "id": "fldAAAAAAAA",
            "name": None,
            "type": None,
            "is_primary": False,
            "is_lookup": False,
            "cell_value_type": None,
            "is_multiple": False,
            "options_lite": {},
        }

    def test_shape_record_defaults(self):
        assert service._shape_record({}) == {
            "id": None,
            "name": "",
            "fields": {},
            "auto_number": None,
            "created_time": None,
            "last_modified_time": None,
        }

    def test_shape_record(self):
        record = {
            "id": "recAAAAAAAA",
            "name": "ACME",
            "fields": {"fldA": 1},
            "autoNumber": 3,
            "createdTime": "t1",
            "lastModifiedTime": "t2",
            "extra": "dropped",
        }
        assert service._shape_record(record) == {
            "id": "recAAAAAAAA",
            "name": "ACME",
            "fields": {"fldA": 1},
            "auto_number": 3,
            "created_time": "t1",
            "last_modified_time": "t2",
        }


@pytest.mark.unit
class TestBrowse:
    def test_list_databases_groups_by_space(self, integration, client):
        groups = service.list_databases(integration, client)
        assert groups == [
            {
                "space": {"id": "spcAAAAAAAA", "name": "Marketing"},
                "bases": [
                    {"id": "bseAAAAAAAA", "name": "CRM", "icon": None},
                    {"id": "bseCCCCCCCC", "name": "Stock", "icon": None},
                ],
            },
            {"space": {"id": "spcBBBBBBBB", "name": ""}, "bases": [{"id": "bseBBBBBBBB", "name": "Ledger", "icon": "💰"}]},
        ]

    @pytest.mark.parametrize("exc", [CyberneticsForbidden("nope"), CyberneticsNotFound("nope")])
    def test_list_databases_tolerates_space_errors(self, integration, client, exc):
        client.list_spaces.side_effect = exc
        groups = service.list_databases(integration, client)
        assert [g["space"]["name"] for g in groups] == ["", ""]

    def test_list_databases_base_without_space(self, integration, client):
        client.list_bases.return_value = [{"id": "bseAAAAAAAA", "name": "CRM"}]
        assert service.list_databases(integration, client) == [
            {"space": {"id": "", "name": ""}, "bases": [{"id": "bseAAAAAAAA", "name": "CRM", "icon": None}]}
        ]

    @pytest.mark.parametrize(
        "method,exc",
        [
            ("list_spaces", CyberneticsUnreachable("down")),
            ("list_spaces", CyberneticsUnauthorized("bad")),
            ("list_bases", CyberneticsForbidden("nope")),
        ],
    )
    def test_list_databases_propagates_other_errors(self, integration, client, method, exc):
        getattr(client, method).side_effect = exc
        with pytest.raises(type(exc)):
            service.list_databases(integration, client)

    def test_list_tables_shaping(self, integration, client):
        client.list_tables.return_value = [
            {"id": "tblAAAAAAAA", "name": "Customers", "icon": "x", "description": "d", "defaultViewId": "viwA"},
            {"id": "tblBBBBBBBB", "name": "Orders", "description": None},
        ]
        assert service.list_tables(integration, client, "bseAAAAAAAA") == [
            {"id": "tblAAAAAAAA", "name": "Customers", "icon": "x", "description": "d", "default_view_id": "viwA"},
            {"id": "tblBBBBBBBB", "name": "Orders", "icon": None, "description": "", "default_view_id": ""},
        ]
        client.list_tables.assert_called_once_with("bseAAAAAAAA")

    def test_schema_checks_table_in_base_and_shapes(self, integration, client):
        schema = service.get_schema(integration, client, "bseAAAAAAAA", "tblAAAAAAAA")
        client.get_table.assert_called_once_with("bseAAAAAAAA", "tblAAAAAAAA")
        client.list_fields.assert_called_once_with("tblAAAAAAAA", None)
        assert service.primary_field_id(schema) == "fldPRIMARY01"
        status = next(f for f in schema["fields"] if f["id"] == "fldSTATUS001")
        assert status["options_lite"] == {"choices": [{"name": "Active", "color": "green"}]}
        assert schema["views"] == [{"id": "viwAAAAAAAA", "name": "Grid", "type": "grid"}]

    def test_schema_propagates_table_not_in_base(self, integration, client):
        client.get_table.side_effect = CyberneticsNotFound("no such table")
        with pytest.raises(CyberneticsNotFound):
            service.get_schema(integration, client, "bseBBBBBBBB", "tblAAAAAAAA")
        client.list_fields.assert_not_called()

    def test_schema_forwards_and_caches_per_view(self, integration, client):
        service.get_schema(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "viwAAAAAAAA")
        service.get_schema(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "viwAAAAAAAA")
        service.get_schema(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "viwBBBBBBBB")
        service.get_schema(integration, client, "bseAAAAAAAA", "tblAAAAAAAA")
        assert [c.args for c in client.list_fields.call_args_list] == [
            ("tblAAAAAAAA", "viwAAAAAAAA"),
            ("tblAAAAAAAA", "viwBBBBBBBB"),
            ("tblAAAAAAAA", None),
        ]
        # The table lookup is cached independently of the view.
        assert client.get_table.call_count == 1

    def test_primary_field_id_missing(self):
        assert service.primary_field_id({"fields": [{"id": "fldA", "is_primary": False}]}) is None

    def test_list_records_with_total(self, integration, client):
        client.list_records.return_value = {"records": [{"id": "recAAAAAAAA", "name": "ACME", "fields": {}}]}
        client.row_count.return_value = 7
        flt = {"conjunction": "and", "filterSet": []}
        order = [{"fieldId": "fldEMAIL0001", "order": "asc"}]
        data = service.list_records(
            integration,
            client,
            "bseAAAAAAAA",
            "tblAAAAAAAA",
            **_records_kwargs(
                take=10,
                skip=20,
                view_id="viwAAAAAAAA",
                search="ac",
                search_field="fldEMAIL0001",
                filter_=flt,
                order_by=order,
                with_total=True,
            ),
        )
        assert data["total"] == 7
        assert (data["take"], data["skip"]) == (10, 20)
        assert data["records"][0]["name"] == "ACME"
        client.list_records.assert_called_once_with(
            "tblAAAAAAAA",
            take=10,
            skip=20,
            view_id="viwAAAAAAAA",
            search="ac",
            search_field="fldEMAIL0001",
            filter_=flt,
            order_by=order,
            projection=[f["id"] for f in FIELDS],
            cell_format="text",
        )
        client.row_count.assert_called_once_with(
            "tblAAAAAAAA", view_id="viwAAAAAAAA", search="ac", search_field="fldEMAIL0001", filter_=flt
        )
        client.list_fields.assert_called_once_with("tblAAAAAAAA", "viwAAAAAAAA")

    def test_list_records_without_total(self, integration, client):
        data = service.list_records(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", **_records_kwargs())
        assert data == {"records": [], "take": 50, "skip": 0}
        client.row_count.assert_not_called()

    @pytest.mark.parametrize("cell_format", ["json", "text"])
    def test_get_record(self, integration, client, cell_format):
        client.get_record.return_value = {"id": "recAAAAAAAA", "name": "ACME", "fields": {"fldEMAIL0001": "a@x"}}
        data = service.get_record(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA", cell_format)
        client.get_record.assert_called_once_with("tblAAAAAAAA", "recAAAAAAAA", cell_format=cell_format)
        client.get_table.assert_called_once_with("bseAAAAAAAA", "tblAAAAAAAA")
        assert data["deep_link"] == "https://data.example.com/base/bseAAAAAAAA/table/tblAAAAAAAA?recordId=recAAAAAAAA"
        assert data["record"]["fields"] == {"fldEMAIL0001": "a@x"}
        assert [f["id"] for f in data["fields"]] == [f["id"] for f in FIELDS]


def _text_field(i, **extra):
    return {"id": f"fldTEXT{i:05d}", "name": f"Text {i}", "type": "singleLineText", **extra}


@pytest.mark.unit
class TestSnapshot:
    def test_build_snapshot(self, integration, client):
        client.get_record.return_value = {
            "id": "recAAAAAAAA",
            "name": "ACME Ltd",
            "fields": {"fldPRIMARY01": "ACME Ltd", "fldEMAIL0001": "a@acme.com", "fldSTATUS001": "Active"},
        }
        snapshot = service.build_snapshot(
            integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA", "viwAAAAAAAA"
        )
        assert snapshot == {
            "space_id": "spcAAAAAAAA",
            "base_id": "bseAAAAAAAA",
            "table_id": "tblAAAAAAAA",
            "record_id": "recAAAAAAAA",
            "view_id": "viwAAAAAAAA",
            "record_name": "ACME Ltd",
            "base_name": "CRM",
            "table_name": "Customers",
            "primary_field_id": "fldPRIMARY01",
            # attachment fields are never copied into the preview
            "preview": {"Email": "a@acme.com", "Status": "Active"},
            "source_url": "https://data.example.com/base/bseAAAAAAAA/table/tblAAAAAAAA?recordId=recAAAAAAAA",
        }
        client.get_record.assert_called_once_with(
            "tblAAAAAAAA",
            "recAAAAAAAA",
            cell_format="text",
            projection=["fldPRIMARY01", "fldEMAIL0001", "fldSTATUS001"],
        )

    def test_excluded_types_and_field_cap(self, integration, client):
        client.list_fields.return_value = [
            {"id": "fldPRIMARY01", "name": "Name", "type": "singleLineText", "isPrimary": True},
            {"id": "fldATTACH001", "name": "Files", "type": "attachment"},
            {"id": "fldBUTTON001", "name": "Go", "type": "button"},
            {"id": "fldLINK00001", "name": "Company", "type": "link"},
            *[_text_field(i) for i in range(6)],
        ]
        client.get_record.return_value = {"name": "ACME", "fields": {f"fldTEXT{i:05d}": f"v{i}" for i in range(6)}}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["preview"] == {"Text 0": "v0", "Text 1": "v1", "Text 2": "v2", "Text 3": "v3"}
        projection = client.get_record.call_args.kwargs["projection"]
        assert projection == ["fldPRIMARY01", *[f"fldTEXT{i:05d}" for i in range(4)]]

    def test_empty_values_dropped_and_values_truncated(self, integration, client):
        client.list_fields.return_value = [_text_field(i) for i in range(4)]
        client.get_record.return_value = {
            "name": "ACME",
            "fields": {"fldTEXT00000": None, "fldTEXT00001": "", "fldTEXT00002": "y" * 300, "fldTEXT00003": 42},
        }
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["preview"] == {"Text 2": "y" * 256, "Text 3": "42"}

    def test_names_truncated(self, integration, client):
        client.get_base.return_value = {"name": "b" * 300, "spaceId": "spcAAAAAAAA"}
        client.get_table.return_value = {"name": "t" * 300}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["base_name"] == "b" * 255
        assert snapshot["table_name"] == "t" * 255

    @pytest.mark.xfail(
        reason="build_snapshot runs the record name through _truncate (256 chars) before the [:512] cut, "
        "so names are capped at 256 although the design and the model field allow 512",
        strict=True,
    )
    def test_record_name_truncated_at_512(self, integration, client):
        client.get_record.return_value = {"name": "r" * 600, "fields": {}}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["record_name"] == "r" * 512

    def test_record_name_is_bounded(self, integration, client):
        client.get_record.return_value = {"name": "r" * 600, "fields": {}}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert 0 < len(snapshot["record_name"]) <= 512

    def test_primary_field_missing(self, integration, client):
        client.list_fields.return_value = [_text_field(0)]
        client.get_record.return_value = {"fields": {"fldTEXT00000": "v"}}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["primary_field_id"] == ""
        assert snapshot["record_name"] == ""
        assert client.get_record.call_args.kwargs["projection"] == ["fldTEXT00000"]

    def test_missing_names_and_space(self, integration, client):
        client.get_base.return_value = {}
        client.get_table.return_value = {}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert (snapshot["space_id"], snapshot["base_name"], snapshot["table_name"]) == ("", "", "")

    @pytest.mark.parametrize("view_id,expected", [("viwAAAAAAAA", "viwAAAAAAAA"), (None, ""), ("", "")])
    def test_view_id_passthrough(self, integration, client, view_id, expected):
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA", view_id)
        assert snapshot["view_id"] == expected

    def test_falls_back_to_primary_value(self, integration, client):
        client.get_record.return_value = {"id": "recAAAAAAAA", "fields": {"fldPRIMARY01": "Fallback"}}
        snapshot = service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")
        assert snapshot["record_name"] == "Fallback"

    @pytest.mark.parametrize("exc", [CyberneticsNotFound("gone"), CyberneticsForbidden("nope")])
    def test_errors_propagate(self, integration, client, exc):
        client.get_record.side_effect = exc
        with pytest.raises(type(exc)):
            service.build_snapshot(integration, client, "bseAAAAAAAA", "tblAAAAAAAA", "recAAAAAAAA")


@pytest.mark.unit
class TestDeepLink:
    def test_with_view(self):
        url = service.build_deep_link("https://d.example.com", "bseA", "tblB", "recC", "viwD")
        assert url == "https://d.example.com/base/bseA/table/tblB/viwD?recordId=recC"

    def test_without_view(self):
        url = service.build_deep_link("https://d.example.com", "bseA", "tblB", "recC")
        assert url == "https://d.example.com/base/bseA/table/tblB?recordId=recC"

    def test_without_record(self):
        assert service.build_deep_link("https://d.example.com", "bseA", "tblB") == "https://d.example.com/base/bseA/table/tblB"

    def test_quoting(self):
        url = service.build_deep_link("https://d.example.com", "bse/A", "tbl?B", "rec&C", "viw#D")
        assert url == "https://d.example.com/base/bse%2FA/table/tbl%3FB/viw%23D?recordId=rec%26C"

    def test_trailing_slash_stripped(self):
        url = service.build_deep_link("https://d.example.com/sub//", "bseA", "tblB")
        assert url == "https://d.example.com/sub/base/bseA/table/tblB"
