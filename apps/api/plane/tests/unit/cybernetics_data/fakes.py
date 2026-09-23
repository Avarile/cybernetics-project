# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Test doubles for the Cybernetics-Data integration (no network, no Redis)."""

import json
import re
from urllib.parse import parse_qsl, unquote, urlsplit


class DictCache:
    """In-memory stand-in for ``django.core.cache.cache`` (and DRF throttle caches)."""

    def __init__(self):
        self.store = {}
        self.timeouts = {}

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, timeout=None):
        self.store[key] = value
        self.timeouts[key] = timeout

    def delete(self, key):
        self.store.pop(key, None)


class FakeResponse:
    """Minimal ``requests.Response`` double supporting streamed reads via ``iter_content``.

    ``raw`` (bytes) takes precedence over ``body``, which is JSON-encoded.
    """

    def __init__(self, status_code=200, body=None, raw=None):
        self.status_code = status_code
        self._content = raw if raw is not None else json.dumps(body).encode()
        self.closed = False

    def iter_content(self, chunk_size=1):
        for start in range(0, len(self._content), chunk_size):
            yield self._content[start : start + chunk_size]

    def close(self):
        # Tests assert on ``closed`` to check the client releases streamed connections.
        self.closed = True


def _record(record_id, name, fields):
    """Build a Teable record payload in the shape the records API returns."""
    return {"id": record_id, "name": name, "fields": fields, "autoNumber": 1, "createdTime": "2026-01-01T00:00:00Z"}


class FakeTeable:
    """Replaces ``client.pinned_fetch``: routes Teable API paths to canned JSON.

    Every call is recorded in ``calls`` (method, host, path, query list, headers).
    ``errors`` maps an API path (without the ``/api`` prefix) to an HTTP status
    code or an exception instance that is returned/raised for that path.
    """

    SPACE_ID = "spcMARKETING1"
    BASE_ID = "bseCRM000001"
    OTHER_BASE_ID = "bseLEDGER001"
    TABLE_ID = "tblCUSTOMERS1"
    VIEW_ID = "viwGRID00001"
    PRIMARY_FIELD = "fldNAME00001"
    EMAIL_FIELD = "fldEMAIL0001"
    FILES_FIELD = "fldFILES0001"
    RECORD_A = "recACME00001"
    RECORD_B = "recGLOBEX001"

    def __init__(self):
        self.calls = []
        self.errors = {}
        self.spaces = [{"id": self.SPACE_ID, "name": "Marketing"}]
        self.bases = {
            self.BASE_ID: {"id": self.BASE_ID, "name": "CRM", "spaceId": self.SPACE_ID, "icon": None},
            self.OTHER_BASE_ID: {"id": self.OTHER_BASE_ID, "name": "Ledger", "spaceId": "", "icon": None},
        }
        self.tables = {
            self.BASE_ID: [
                {"id": self.TABLE_ID, "name": "Customers", "icon": None, "defaultViewId": self.VIEW_ID},
            ],
            self.OTHER_BASE_ID: [],
        }
        self.fields = {
            self.TABLE_ID: [
                {"id": self.PRIMARY_FIELD, "name": "Name", "type": "singleLineText", "isPrimary": True},
                {"id": self.EMAIL_FIELD, "name": "Email", "type": "singleLineText"},
                {"id": self.FILES_FIELD, "name": "Files", "type": "attachment"},
            ]
        }
        self.views = {self.TABLE_ID: [{"id": self.VIEW_ID, "name": "Grid", "type": "grid"}]}
        self.records = {
            self.TABLE_ID: {
                self.RECORD_A: _record(self.RECORD_A, "ACME", {self.PRIMARY_FIELD: "ACME", self.EMAIL_FIELD: "a@acme"}),
                self.RECORD_B: _record(self.RECORD_B, "Globex", {self.PRIMARY_FIELD: "Globex"}),
            }
        }

    # ------------------------------------------------------------------ helpers
    def paths(self):
        """Return the API paths of all recorded calls, in call order."""
        return [call["path"] for call in self.calls]

    def calls_to(self, path):
        """Return the recorded calls whose path equals ``path``."""
        return [call for call in self.calls if call["path"] == path]

    # ------------------------------------------------------------------ routing
    def _route(self, path, query):
        """Dispatch ``path`` to a canned payload; an ``int`` return means an HTTP error status."""
        routes = [
            (r"/space", lambda: self.spaces),
            (r"/base/access/all", lambda: list(self.bases.values())),
            (r"/base/(?P<base>[^/]+)", lambda base: self.bases.get(base, 404)),
            (r"/base/(?P<base>[^/]+)/table", lambda base: self.tables.get(base, 404)),
            (r"/base/(?P<base>[^/]+)/table/(?P<table>[^/]+)", self._get_table),
            (r"/table/(?P<table>[^/]+)/field", lambda table: self.fields.get(table, 404)),
            (r"/table/(?P<table>[^/]+)/view", lambda table: self.views.get(table, 404)),
            (r"/table/(?P<table>[^/]+)/record", lambda table: self._list_records(table, query)),
            (r"/table/(?P<table>[^/]+)/aggregation/row-count", lambda table: self._row_count(table)),
            (r"/table/(?P<table>[^/]+)/record/(?P<record>[^/]+)", self._get_record),
        ]
        # fullmatch ensures e.g. "/base/x/table" is not swallowed by the "/base/<base>" route.
        for pattern, handler in routes:
            match = re.fullmatch(pattern, path)
            if match:
                return handler(**{k: unquote(v) for k, v in match.groupdict().items()})
        return 404

    def _get_table(self, base, table):
        return next((t for t in self.tables.get(base, []) if t["id"] == table), 404)

    def _list_records(self, table, query):
        """Emulate Teable's ``take``/``skip`` pagination over the table's records."""
        if table not in self.records:
            return 404
        params = dict(query)
        take = int(params.get("take", 50))
        skip = int(params.get("skip", 0))
        return {"records": list(self.records[table].values())[skip : skip + take]}

    def _row_count(self, table):
        if table not in self.records:
            return 404
        return {"rowCount": len(self.records[table])}

    def _get_record(self, table, record):
        return self.records.get(table, {}).get(record, 404)

    # ----------------------------------------------------------- pinned_fetch
    def __call__(self, method, url, *, allowed_ips=None, allowed_hosts=None, headers=None, timeout=None, **kwargs):
        """Mimic ``pinned_fetch``: record the call, apply injected ``errors``, then route."""
        parts = urlsplit(url)
        assert parts.path.startswith("/api/"), url
        path = parts.path[len("/api") :]
        query = parse_qsl(parts.query, keep_blank_values=True)
        self.calls.append(
            {
                "method": method,
                "host": parts.hostname,
                "path": path,
                "query": query,
                "headers": dict(headers or {}),
                "timeout": timeout,
                "stream": kwargs.get("stream"),
            }
        )
        error = self.errors.get(path)
        if isinstance(error, BaseException):
            raise error
        if isinstance(error, int):
            return FakeResponse(error, {"message": f"fake error {error}"})
        result = self._route(path, query)
        if isinstance(result, int):
            return FakeResponse(result, {"message": "not found"})
        return FakeResponse(200, result)
