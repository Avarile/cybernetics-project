# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Read-only HTTP client for the Cybernetics-Data (Teable fork) REST API.

Every request goes through :func:`plane.utils.url_security.pinned_fetch`, so
the target is resolved, validated and pinned (SSRF-safe) and redirects are
never followed. Query serialisation mirrors ``@teable/openapi``: complex
parameters (``filter``, ``orderBy``) are JSON strings and tuple/array
parameters use the ``name[]`` form understood by Express/qs.
"""

# Python imports
import json
from urllib.parse import quote, urlencode, urlsplit

# Django imports
from django.conf import settings

# Third party imports
import requests

# Module imports
from plane.utils.exception_logger import log_exception
from plane.utils.url_security import pinned_fetch


class CyberneticsDataError(Exception):
    """Base error for upstream failures; ``code``/``http_status`` drive the API error response."""

    code = "CYBERNETICS_ERROR"
    http_status = 502

    def __init__(self, message="Cybernetics-Data request failed", upstream_status=None):
        super().__init__(message)
        self.message = message
        self.upstream_status = upstream_status


class CyberneticsUnauthorized(CyberneticsDataError):
    # 424 on purpose: the web client treats 401 as "Plane session expired".
    code = "CYBERNETICS_UNAUTHORIZED"
    http_status = 424


class CyberneticsForbidden(CyberneticsDataError):
    """Upstream returned 403: the token lacks access to the resource."""

    code = "CYBERNETICS_FORBIDDEN"
    http_status = 403


class CyberneticsNotFound(CyberneticsDataError):
    """Upstream returned 404."""

    code = "CYBERNETICS_NOT_FOUND"
    http_status = 404


class CyberneticsBadRequest(CyberneticsDataError):
    """Upstream rejected the request (400/422)."""

    code = "CYBERNETICS_BAD_REQUEST"
    http_status = 400


class CyberneticsRateLimited(CyberneticsDataError):
    """Upstream returned 429."""

    code = "CYBERNETICS_RATE_LIMITED"
    http_status = 429


class CyberneticsUnreachable(CyberneticsDataError):
    """Network failure, disallowed URL, redirect, oversized or malformed upstream response."""

    code = "CYBERNETICS_UNREACHABLE"
    http_status = 502


# Upstream HTTP status -> exception class; any other >=400 status maps to CyberneticsUnreachable.
_STATUS_EXCEPTIONS = {
    400: CyberneticsBadRequest,
    401: CyberneticsUnauthorized,
    403: CyberneticsForbidden,
    404: CyberneticsNotFound,
    422: CyberneticsBadRequest,
    429: CyberneticsRateLimited,
}

# Truncation limit for upstream error messages surfaced to clients.
MAX_MESSAGE_LENGTH = 300


def normalize_base_url(value, require_https=None):
    """Normalize a user-supplied Cybernetics-Data origin.

    Strips whitespace, trailing slashes and a trailing ``/api``; rejects
    credentials, query strings and fragments. Raises ``ValueError``.
    """
    if require_https is None:
        # HTTPS is only enforced outside DEBUG so local http instances work in development
        require_https = settings.CYBERNETICS_DATA_REQUIRE_HTTPS and not settings.DEBUG
    url = (value or "").strip()
    if not url:
        raise ValueError("URL is required")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError("URL must start with http:// or https://")
    if require_https and parts.scheme != "https":
        raise ValueError("URL must use https://")
    if not parts.hostname:
        raise ValueError("URL has no host")
    if parts.username or parts.password:
        raise ValueError("URL must not contain credentials")
    if parts.query or parts.fragment:
        raise ValueError("URL must not contain a query string or fragment")
    # The client appends "/api" itself, so drop it if the user pasted the API root
    path = parts.path.rstrip("/")
    if path.endswith("/api"):
        path = path[: -len("/api")]
    return f"{parts.scheme}://{parts.netloc}{path}"


def _extract_message(body, status_code):
    """Pull ``message`` from an upstream JSON error body, falling back to a generic text; truncated."""
    try:
        data = json.loads(body or b"null")
        message = data.get("message") if isinstance(data, dict) else None
    except ValueError:
        message = None
    if not isinstance(message, str) or not message:
        message = f"Cybernetics-Data responded with HTTP {status_code}"
    return message[:MAX_MESSAGE_LENGTH]


def _expect_list(data):
    """Upstream list payload → list of objects (``None`` → ``[]``)."""
    if data is None:
        return []
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        raise CyberneticsUnreachable("Cybernetics-Data returned an unexpected response")
    return data


def _expect_dict(data):
    """Upstream object payload → dict (``None`` → ``{}``)."""
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise CyberneticsUnreachable("Cybernetics-Data returned an unexpected response")
    return data


class CyberneticsDataClient:
    """Read-only client bound to one Cybernetics-Data instance and API token.

    All public methods issue GET requests and raise ``CyberneticsDataError`` subclasses on failure.
    """

    # Upper bound on page size for list_records
    MAX_TAKE = 200
    # Responses larger than this (5 MiB) are aborted while streaming
    MAX_RESPONSE_BYTES = 5 * 1024 * 1024

    def __init__(self, base_url, token, timeout=None):
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = timeout if timeout is not None else settings.CYBERNETICS_DATA_TIMEOUT

    def __repr__(self):
        # Never expose the token in logs / tracebacks.
        return f"<CyberneticsDataClient {self.base_url}>"

    def _get(self, path, params=None):
        """GET ``{base_url}/api{path}`` via pinned_fetch and return the decoded JSON body.

        ``params`` is a list of (key, value) tuples so repeated keys (``name[]``) are preserved.
        Transport errors, redirects and >=400 statuses are mapped to ``CyberneticsDataError`` subclasses.
        """
        query = urlencode(params or [], doseq=True)
        url = f"{self.base_url}/api{path}" + (f"?{query}" if query else "")
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            "User-Agent": "cybernetics-projects",
        }
        try:
            response = pinned_fetch(
                "GET",
                url,
                allowed_ips=settings.CYBERNETICS_DATA_ALLOWED_IPS,
                allowed_hosts=settings.CYBERNETICS_DATA_ALLOWED_HOSTS,
                headers=headers,
                timeout=self.timeout,
                stream=True,
            )
        except ValueError:
            # pinned_fetch raises ValueError when the host fails SSRF validation / allow-lists
            raise CyberneticsUnreachable("The Cybernetics-Data URL is not allowed or could not be resolved")
        except requests.Timeout as e:
            log_exception(e, warning=True)
            raise CyberneticsUnreachable("Cybernetics-Data did not respond in time")
        except requests.RequestException as e:
            log_exception(e, warning=True)
            raise CyberneticsUnreachable("Could not connect to Cybernetics-Data")

        try:
            status_code = response.status_code
            # Redirects are never followed (they could point at an internal host)
            if 300 <= status_code < 400:
                raise CyberneticsUnreachable("Cybernetics-Data responded with an unexpected redirect", status_code)
            body = self._read_body(response)
        finally:
            response.close()

        if status_code >= 400:
            exc_class = _STATUS_EXCEPTIONS.get(status_code, CyberneticsUnreachable)
            raise exc_class(_extract_message(body, status_code), status_code)
        try:
            return json.loads(body or b"null")
        except ValueError:
            raise CyberneticsUnreachable("Cybernetics-Data returned an invalid response", status_code)

    def _read_body(self, response):
        """Read a streamed response body, aborting once it exceeds MAX_RESPONSE_BYTES."""
        chunks = []
        size = 0
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                size += len(chunk)
                if size > self.MAX_RESPONSE_BYTES:
                    raise CyberneticsUnreachable("Cybernetics-Data response is too large")
                chunks.append(chunk)
        except requests.RequestException as e:
            log_exception(e, warning=True)
            raise CyberneticsUnreachable("Connection to Cybernetics-Data was interrupted")
        return b"".join(chunks)

    @staticmethod
    def _seg(value):
        """Percent-encode a value for safe use as a single URL path segment."""
        return quote(str(value), safe="")

    def list_spaces(self):
        """Return the spaces visible to the token."""
        return _expect_list(self._get("/space"))

    def list_bases(self):
        """Return all bases the token can access."""
        return _expect_list(self._get("/base/access/all"))

    def get_base(self, base_id):
        """Return a single base."""
        return _expect_dict(self._get(f"/base/{self._seg(base_id)}"))

    def list_tables(self, base_id):
        """Return the tables in a base."""
        return _expect_list(self._get(f"/base/{self._seg(base_id)}/table"))

    def get_table(self, base_id, table_id):
        """Return a single table of a base."""
        return _expect_dict(self._get(f"/base/{self._seg(base_id)}/table/{self._seg(table_id)}"))

    def list_fields(self, table_id, view_id=None):
        """Return the fields of a table, optionally as seen through ``view_id``."""
        params = [("viewId", view_id)] if view_id else []
        return _expect_list(self._get(f"/table/{self._seg(table_id)}/field", params))

    def list_views(self, table_id):
        """Return the views of a table."""
        return _expect_list(self._get(f"/table/{self._seg(table_id)}/view"))

    @staticmethod
    def _query_params(view_id=None, search=None, search_field=None, filter_=None):
        """Build the shared record-query params (view, search tuple, JSON filter) keyed by field id."""
        params = [("fieldKeyType", "id")]
        if view_id:
            params.append(("viewId", view_id))
        if search:
            # Teable's search is a [value, fieldId, hideNotMatchRow] tuple sent as repeated search[]
            params.append(("search[]", search))
            params.append(("search[]", search_field or ""))
            params.append(("search[]", "true"))
        if filter_:
            params.append(("filter", json.dumps(filter_, separators=(",", ":"))))
        return params

    def list_records(
        self,
        table_id,
        *,
        take=50,
        skip=0,
        view_id=None,
        search=None,
        search_field=None,
        filter_=None,
        order_by=None,
        projection=None,
        cell_format="text",
    ):
        """Return one page of records (``{"records": [...], ...}``) for a table.

        ``take`` is clamped to 1..MAX_TAKE; ``order_by``/``filter_`` are sent as compact JSON;
        ``projection`` limits the returned field ids.
        """
        take = max(1, min(int(take), self.MAX_TAKE))
        params = self._query_params(view_id, search, search_field, filter_)
        params += [("take", take), ("skip", max(0, int(skip))), ("cellFormat", cell_format)]
        if order_by:
            params.append(("orderBy", json.dumps(order_by, separators=(",", ":"))))
        for field_id in projection or []:
            params.append(("projection[]", field_id))
        data = _expect_dict(self._get(f"/table/{self._seg(table_id)}/record", params))
        data["records"] = _expect_list(data.get("records"))
        return data

    def row_count(self, table_id, *, view_id=None, search=None, search_field=None, filter_=None):
        """Return the number of records matching the same view/search/filter as list_records."""
        params = self._query_params(view_id, search, search_field, filter_)
        data = _expect_dict(self._get(f"/table/{self._seg(table_id)}/aggregation/row-count", params))
        return int(data.get("rowCount") or 0)

    def get_record(self, table_id, record_id, *, cell_format="json", projection=None):
        """Return a single record (cell values as JSON by default)."""
        params = [("fieldKeyType", "id"), ("cellFormat", cell_format)]
        for field_id in projection or []:
            params.append(("projection[]", field_id))
        return _expect_dict(self._get(f"/table/{self._seg(table_id)}/record/{self._seg(record_id)}", params))
