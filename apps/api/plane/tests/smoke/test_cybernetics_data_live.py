# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The real ``pinned_fetch`` against a fake Cybernetics-Data server on 127.0.0.1."""

import ipaddress
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import pytest

from plane.utils.cybernetics_data.client import CyberneticsDataClient, CyberneticsUnreachable
from plane.utils.cybernetics_data.service import verify_connection

TOKEN = "cybernetics_live_smoke_token_01"

ROUTES = {
    "/api/base/access/all": [{"id": "bseAAAAAAAA", "name": "CRM", "spaceId": "spcAAAAAAAA"}],
    "/api/base/bseAAAAAAAA/table": [{"id": "tblAAAAAAAA", "name": "Customers"}],
    "/api/table/tblAAAAAAAA/record": {"records": [{"id": "recAAAAAAAA", "name": "ACME", "fields": {}}]},
}


class _Handler(BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        self.seen.append({"path": self.path, "authorization": self.headers.get("Authorization")})
        if path == "/api/space":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        body = ROUTES.get(path)
        payload = json.dumps(body if body is not None else {"message": "not found"}).encode()
        self.send_response(200 if body is not None else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


@pytest.fixture
def server(settings):
    settings.CYBERNETICS_DATA_ALLOWED_IPS = [ipaddress.ip_network("127.0.0.0/8")]
    settings.CYBERNETICS_DATA_ALLOWED_HOSTS = []
    _Handler.seen = []
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


@pytest.mark.smoke
@pytest.mark.slow
class TestLiveFetch:
    def test_verify_connection(self, server):
        result = verify_connection(CyberneticsDataClient(server, TOKEN, timeout=5))
        assert result == {"status": "ok", "message": "", "bases_visible": 1}
        assert {s["authorization"] for s in _Handler.seen} == {f"Bearer {TOKEN}"}

    def test_list_records(self, server):
        data = CyberneticsDataClient(server, TOKEN, timeout=5).list_records(
            "tblAAAAAAAA", search="acme", projection=["fldAAAAAAAA"]
        )
        assert [r["id"] for r in data["records"]] == ["recAAAAAAAA"]
        assert "search%5B%5D=acme" in _Handler.seen[-1]["path"]

    def test_redirect_is_not_followed(self, server):
        with pytest.raises(CyberneticsUnreachable, match="redirect"):
            CyberneticsDataClient(server, TOKEN, timeout=5).list_spaces()
        assert [s["path"] for s in _Handler.seen] == ["/api/space"]

    def test_loopback_blocked_without_allowlist(self, server, settings):
        settings.CYBERNETICS_DATA_ALLOWED_IPS = []
        with pytest.raises(CyberneticsUnreachable, match="not allowed"):
            CyberneticsDataClient(server, TOKEN, timeout=5).list_bases()
        assert _Handler.seen == []
