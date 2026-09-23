# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import ipaddress
import json
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qsl, urlsplit

import pytest
import requests

from plane.utils.cybernetics_data.client import (
    MAX_MESSAGE_LENGTH,
    CyberneticsBadRequest,
    CyberneticsDataClient,
    CyberneticsForbidden,
    CyberneticsNotFound,
    CyberneticsRateLimited,
    CyberneticsUnauthorized,
    CyberneticsUnreachable,
    _expect_dict,
    _expect_list,
    _extract_message,
    normalize_base_url,
)

FETCH = "plane.utils.cybernetics_data.client.pinned_fetch"
LOG = "plane.utils.cybernetics_data.client.log_exception"
TOKEN = "cybernetics_abc123_c2lnbmF0dXJl"
BASE = "https://data.example.com"


def _response(status_code=200, body=None, raw=None, chunks=None):
    response = MagicMock()
    response.status_code = status_code
    if chunks is None:
        chunks = [raw if raw is not None else json.dumps(body).encode()]
    response.iter_content.return_value = chunks
    return response


def _client(**kwargs):
    return CyberneticsDataClient(BASE, TOKEN, **kwargs)


def _query(mock_fetch):
    url = mock_fetch.call_args.args[1]
    return urlsplit(url).path, parse_qsl(urlsplit(url).query, keep_blank_values=True)


def _values(params, key):
    return [v for k, v in params if k == key]


@pytest.mark.unit
class TestNormalizeBaseUrl:
    @pytest.mark.parametrize(
        "value,expected",
        [
            ("https://data.example.com", "https://data.example.com"),
            ("  https://data.example.com/  ", "https://data.example.com"),
            ("https://data.example.com/api", "https://data.example.com"),
            ("https://data.example.com/api/", "https://data.example.com"),
            ("https://example.com/data/api", "https://example.com/data"),
            ("https://example.com/data/", "https://example.com/data"),
            ("https://data.example.com:8443", "https://data.example.com:8443"),
            ("https://data.example.com:8443/api", "https://data.example.com:8443"),
        ],
    )
    def test_valid(self, value, expected):
        assert normalize_base_url(value, require_https=True) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "",
            None,
            "   ",
            "data.example.com",
            "ftp://data.example.com",
            "https://user:pass@data.example.com",
            "https://user@data.example.com",
            "https://data.example.com/?x=1",
            "https://data.example.com/#frag",
            "https://",
        ],
    )
    def test_invalid(self, value):
        with pytest.raises(ValueError):
            normalize_base_url(value, require_https=True)

    def test_require_https_on_and_off(self):
        with pytest.raises(ValueError, match="https"):
            normalize_base_url("http://data.example.com", require_https=True)
        assert normalize_base_url("http://data.example.com", require_https=False) == "http://data.example.com"

    @pytest.mark.parametrize(
        "require_https,debug,http_allowed",
        [(True, False, False), (True, True, True), (False, False, True), (False, True, True)],
    )
    def test_default_reads_settings(self, settings, require_https, debug, http_allowed):
        settings.CYBERNETICS_DATA_REQUIRE_HTTPS = require_https
        settings.DEBUG = debug
        if http_allowed:
            assert normalize_base_url("http://data.example.com") == "http://data.example.com"
        else:
            with pytest.raises(ValueError):
                normalize_base_url("http://data.example.com")


@pytest.mark.unit
class TestClientTransport:
    def test_request_shape(self):
        client = _client(timeout=5)
        with patch(FETCH, return_value=_response(body=[])) as mock_fetch:
            assert client.list_bases() == []
        method, url = mock_fetch.call_args.args
        kwargs = mock_fetch.call_args.kwargs
        assert method == "GET"
        # no params -> no "?"
        assert url == "https://data.example.com/api/base/access/all"
        assert kwargs["headers"] == {
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "User-Agent": "cybernetics-projects",
        }
        assert kwargs["timeout"] == 5
        assert kwargs["stream"] is True

    def test_allowlists_come_from_settings(self, settings):
        networks = [ipaddress.ip_network("10.0.0.0/8")]
        settings.CYBERNETICS_DATA_ALLOWED_IPS = networks
        settings.CYBERNETICS_DATA_ALLOWED_HOSTS = ["data.example.com"]
        with patch(FETCH, return_value=_response(body=[])) as mock_fetch:
            _client().list_spaces()
        assert mock_fetch.call_args.kwargs["allowed_ips"] == networks
        assert mock_fetch.call_args.kwargs["allowed_hosts"] == ["data.example.com"]

    def test_default_timeout_from_settings(self, settings):
        settings.CYBERNETICS_DATA_TIMEOUT = 7.5
        assert _client().timeout == 7.5

    def test_trailing_slash_on_base_url(self):
        client = CyberneticsDataClient("https://data.example.com/", TOKEN)
        with patch(FETCH, return_value=_response(body=[])) as mock_fetch:
            client.list_spaces()
        assert mock_fetch.call_args.args[1] == "https://data.example.com/api/space"

    def test_repr_hides_token(self):
        client = _client()
        assert TOKEN not in repr(client)
        assert BASE in repr(client)


@pytest.mark.unit
class TestErrorMapping:
    @pytest.mark.parametrize(
        "status_code,exc",
        [
            (400, CyberneticsBadRequest),
            (401, CyberneticsUnauthorized),
            (403, CyberneticsForbidden),
            (404, CyberneticsNotFound),
            (422, CyberneticsBadRequest),
            (429, CyberneticsRateLimited),
            (500, CyberneticsUnreachable),
            (503, CyberneticsUnreachable),
        ],
    )
    def test_status_mapping(self, status_code, exc):
        body = {"message": "upstream says no", "status": status_code, "code": "x"}
        with patch(FETCH, return_value=_response(status_code, body)):
            with pytest.raises(exc) as info:
                _client().list_spaces()
        assert type(info.value) is exc
        assert info.value.message == "upstream says no"
        assert info.value.upstream_status == status_code

    def test_unauthorized_is_not_http_401(self):
        assert CyberneticsUnauthorized.http_status == 424

    def test_message_is_truncated(self):
        with patch(FETCH, return_value=_response(400, {"message": "x" * 1000})):
            with pytest.raises(CyberneticsBadRequest) as info:
                _client().list_spaces()
        assert len(info.value.message) == MAX_MESSAGE_LENGTH == 300

    @pytest.mark.parametrize(
        "body",
        [b"<html>oops</html>", b"[1, 2]", b'{"message": ""}', b'{"message": 42}', b'{"other": 1}', b"", None],
    )
    def test_extract_message_fallback(self, body):
        assert _extract_message(body, 500) == "Cybernetics-Data responded with HTTP 500"

    def test_extract_message_uses_upstream_message(self):
        assert _extract_message(b'{"message": "nope"}', 403) == "nope"


@pytest.mark.unit
class TestRedirects:
    @pytest.mark.parametrize("status_code", [301, 302, 307, 308])
    def test_redirect_is_rejected(self, status_code):
        response = _response(status_code, raw=b"")
        with patch(FETCH, return_value=response):
            with pytest.raises(CyberneticsUnreachable) as info:
                _client().list_spaces()
        assert info.value.upstream_status == status_code
        response.iter_content.assert_not_called()
        response.close.assert_called_once()


@pytest.mark.unit
class TestTransportFailures:
    @pytest.mark.parametrize(
        "error,logged",
        [
            (ValueError("blocked"), False),
            (requests.Timeout(), True),
            (requests.ConnectionError(), True),
        ],
    )
    def test_transport_errors(self, error, logged):
        with patch(FETCH, side_effect=error), patch(LOG) as mock_log:
            with pytest.raises(CyberneticsUnreachable):
                _client().list_spaces()
        assert mock_log.called is logged

    def test_error_while_streaming(self):
        response = _response()
        response.iter_content.side_effect = requests.exceptions.ChunkedEncodingError()
        with patch(FETCH, return_value=response), patch(LOG) as mock_log:
            with pytest.raises(CyberneticsUnreachable):
                _client().list_spaces()
        mock_log.assert_called_once()
        response.close.assert_called_once()


@pytest.mark.unit
class TestBody:
    def test_size_cap(self):
        client = _client()
        client.MAX_RESPONSE_BYTES = 10
        response = _response(chunks=[b"[1,2,3,", b"4,5,6,7]"])
        with patch(FETCH, return_value=response):
            with pytest.raises(CyberneticsUnreachable, match="too large"):
                client.list_spaces()
        response.close.assert_called_once()

    def test_chunks_are_joined(self):
        response = _response(chunks=[b'[{"id": "sp', b'cAAAAAAAA"}]'])
        with patch(FETCH, return_value=response):
            assert _client().list_spaces() == [{"id": "spcAAAAAAAA"}]
        response.close.assert_called_once()

    def test_invalid_json(self):
        with patch(FETCH, return_value=_response(raw=b"<html>")):
            with pytest.raises(CyberneticsUnreachable, match="invalid response"):
                _client().list_spaces()

    def test_empty_body_gives_empty_defaults(self):
        with patch(FETCH, return_value=_response(raw=b"")):
            assert _client().list_spaces() == []
        with patch(FETCH, return_value=_response(raw=b"")):
            assert _client().get_base("bseAAAAAAAA") == {}
        with patch(FETCH, return_value=_response(raw=b"")):
            assert _client().list_records("tblAAAAAAAA")["records"] == []


@pytest.mark.unit
class TestShapeGuards:
    def test_expect_list(self):
        assert _expect_list(None) == []
        assert _expect_list([{"id": 1}]) == [{"id": 1}]
        with pytest.raises(CyberneticsUnreachable):
            _expect_list({"id": 1})
        with pytest.raises(CyberneticsUnreachable):
            _expect_list([{"id": 1}, "x"])

    def test_expect_dict(self):
        assert _expect_dict(None) == {}
        assert _expect_dict({"id": 1}) == {"id": 1}
        with pytest.raises(CyberneticsUnreachable):
            _expect_dict([{"id": 1}])

    def test_endpoints_reject_wrong_shape(self):
        with patch(FETCH, return_value=_response(body={"not": "a list"})):
            with pytest.raises(CyberneticsUnreachable):
                _client().list_bases()
        with patch(FETCH, return_value=_response(body=["x"])):
            with pytest.raises(CyberneticsUnreachable):
                _client().get_table("bseAAAAAAAA", "tblAAAAAAAA")
        with patch(FETCH, return_value=_response(body={"records": {"id": 1}})):
            with pytest.raises(CyberneticsUnreachable):
                _client().list_records("tblAAAAAAAA")


@pytest.mark.unit
class TestEndpoints:
    @pytest.mark.parametrize(
        "call,body,path,params",
        [
            (lambda c: c.list_spaces(), [], "/api/space", []),
            (lambda c: c.list_bases(), [], "/api/base/access/all", []),
            (lambda c: c.get_base("bseAAAAAAAA"), {}, "/api/base/bseAAAAAAAA", []),
            (lambda c: c.list_tables("bseAAAAAAAA"), [], "/api/base/bseAAAAAAAA/table", []),
            (
                lambda c: c.get_table("bseAAAAAAAA", "tblAAAAAAAA"),
                {},
                "/api/base/bseAAAAAAAA/table/tblAAAAAAAA",
                [],
            ),
            (lambda c: c.list_fields("tblAAAAAAAA"), [], "/api/table/tblAAAAAAAA/field", []),
            (
                lambda c: c.list_fields("tblAAAAAAAA", "viwAAAAAAAA"),
                [],
                "/api/table/tblAAAAAAAA/field",
                [("viewId", "viwAAAAAAAA")],
            ),
            (lambda c: c.list_views("tblAAAAAAAA"), [], "/api/table/tblAAAAAAAA/view", []),
            (
                lambda c: c.list_records("tblAAAAAAAA"),
                {"records": []},
                "/api/table/tblAAAAAAAA/record",
                [("fieldKeyType", "id"), ("take", "50"), ("skip", "0"), ("cellFormat", "text")],
            ),
            (
                lambda c: c.row_count("tblAAAAAAAA"),
                {"rowCount": 1},
                "/api/table/tblAAAAAAAA/aggregation/row-count",
                [("fieldKeyType", "id")],
            ),
            (
                lambda c: c.get_record("tblAAAAAAAA", "recAAAAAAAA"),
                {},
                "/api/table/tblAAAAAAAA/record/recAAAAAAAA",
                [("fieldKeyType", "id"), ("cellFormat", "json")],
            ),
        ],
    )
    def test_paths(self, call, body, path, params):
        with patch(FETCH, return_value=_response(body=body)) as mock_fetch:
            call(_client())
        assert _query(mock_fetch) == (path, params)

    def test_path_segments_are_quoted(self):
        with patch(FETCH, return_value=_response(body=[])) as mock_fetch:
            _client().list_tables("bse/../x")
        assert _query(mock_fetch)[0] == "/api/base/bse%2F..%2Fx/table"
        with patch(FETCH, return_value=_response(body={})) as mock_fetch:
            _client().get_record("tbl?a=1", "rec#x")
        assert mock_fetch.call_args.args[1].startswith(f"{BASE}/api/table/tbl%3Fa%3D1/record/rec%23x?")


@pytest.mark.unit
class TestQuerySerialisation:
    def _params(self, **kwargs):
        with patch(FETCH, return_value=_response(body={"records": []})) as mock_fetch:
            _client().list_records("tblAAAAAAAA", **kwargs)
        return _query(mock_fetch)[1]

    def test_list_records_all_params(self):
        flt = {"conjunction": "and", "filterSet": [{"fieldId": "fldAAAAAAAA", "operator": "is", "value": "x"}]}
        order = [{"fieldId": "fldAAAAAAAA", "order": "desc"}]
        params = self._params(
            take=10,
            skip=10,
            view_id="viwAAAAAAAA",
            search="acme",
            search_field="fldAAAAAAAA",
            filter_=flt,
            order_by=order,
            projection=["fldAAAAAAAA", "fldBBBBBBBB"],
            cell_format="json",
        )
        assert params == [
            ("fieldKeyType", "id"),
            ("viewId", "viwAAAAAAAA"),
            ("search[]", "acme"),
            ("search[]", "fldAAAAAAAA"),
            ("search[]", "true"),
            ("filter", json.dumps(flt, separators=(",", ":"))),
            ("take", "10"),
            ("skip", "10"),
            ("cellFormat", "json"),
            ("orderBy", json.dumps(order, separators=(",", ":"))),
            ("projection[]", "fldAAAAAAAA"),
            ("projection[]", "fldBBBBBBBB"),
        ]
        assert " " not in dict(params)["filter"]
        assert " " not in dict(params)["orderBy"]

    @pytest.mark.parametrize("take,expected", [(0, "1"), (-5, "1"), (1, "1"), (200, "200"), (999, "200")])
    def test_take_is_clamped(self, take, expected):
        assert dict(self._params(take=take))["take"] == expected

    @pytest.mark.parametrize("skip,expected", [(-3, "0"), (0, "0"), (25, "25")])
    def test_skip_is_clamped(self, skip, expected):
        assert dict(self._params(skip=skip))["skip"] == expected

    def test_search_all_fields(self):
        assert _values(self._params(search="acme"), "search[]") == ["acme", "", "true"]

    def test_no_search(self):
        params = self._params(search_field="fldAAAAAAAA")
        assert "search[]" not in dict(params)
        assert "filter" not in dict(params)
        assert "orderBy" not in dict(params)
        assert "projection[]" not in dict(params)
        assert "viewId" not in dict(params)

    def test_row_count_params(self):
        flt = {"conjunction": "and", "filterSet": []}
        with patch(FETCH, return_value=_response(body={"rowCount": 42})) as mock_fetch:
            count = _client().row_count(
                "tblAAAAAAAA", view_id="viwAAAAAAAA", search="acme", search_field="fldAAAAAAAA", filter_=flt
            )
        assert count == 42
        path, params = _query(mock_fetch)
        assert path == "/api/table/tblAAAAAAAA/aggregation/row-count"
        assert ("fieldKeyType", "id") in params
        assert ("viewId", "viwAAAAAAAA") in params
        assert _values(params, "search[]") == ["acme", "fldAAAAAAAA", "true"]
        assert dict(params)["filter"] == '{"conjunction":"and","filterSet":[]}'

    def test_get_record_projection(self):
        with patch(FETCH, return_value=_response(body={"id": "recAAAAAAAA"})) as mock_fetch:
            _client().get_record("tblAAAAAAAA", "recAAAAAAAA", cell_format="text", projection=["fldA0000000"])
        params = _query(mock_fetch)[1]
        assert params == [("fieldKeyType", "id"), ("cellFormat", "text"), ("projection[]", "fldA0000000")]

    @pytest.mark.parametrize("body", [{}, {"rowCount": None}, None])
    def test_row_count_missing(self, body):
        with patch(FETCH, return_value=_response(body=body)):
            assert _client().row_count("tblAAAAAAAA") == 0
