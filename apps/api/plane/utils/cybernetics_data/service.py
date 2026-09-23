# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Integration lookup, verification, response shaping and snapshots.

Service layer between the Cybernetics-Data API views and ``CyberneticsDataClient``:
resolves a project's ``ProjectCyberneticsDataIntegration``, caches metadata lookups in
the Django cache, reshapes upstream payloads into snake_case API responses and builds
the denormalised snapshot stored on ``IssueCyberneticsRecord`` rows.
"""

# Python imports
import hashlib
from urllib.parse import quote

# Django imports
from django.conf import settings
from django.core.cache import cache

# Module imports
from plane.db.models import ProjectCyberneticsDataIntegration
from .client import (
    CyberneticsDataClient,
    CyberneticsDataError,
    CyberneticsForbidden,
    CyberneticsNotFound,
    CyberneticsUnauthorized,
    CyberneticsUnreachable,
)
from .secrets import TokenDecryptionError, decrypt_token

# Upper bound of records attached or refreshed per request (each one is an upstream call).
MAX_RECORDS_PER_REQUEST = 10
# Snapshot preview: how many non-primary fields to keep and the max length of each value
PREVIEW_FIELD_COUNT = 4
PREVIEW_VALUE_LENGTH = 256
# Field types whose text form is not useful as a preview
_PREVIEW_EXCLUDED_TYPES = {"attachment", "button", "link"}

# Cache lifetime in seconds per kind of cached upstream lookup
CACHE_TTL = {"databases": 60, "tables": 60, "table": 300, "schema": 120, "base": 300}


class IntegrationNotConfigured(CyberneticsDataError):
    """The project has no integration, or it (or the feature flag) is disabled."""

    code = "CYBERNETICS_NOT_CONFIGURED"
    http_status = 404

    def __init__(self, message="Cybernetics Data is not configured for this project"):
        super().__init__(message)


class TokenUnreadable(CyberneticsDataError):
    """The stored token can't be decrypted (e.g. SECRET_KEY rotated); the user must re-enter it."""

    code = "CYBERNETICS_TOKEN_UNREADABLE"
    http_status = 409

    def __init__(self, message="The stored Cybernetics-Data token can't be read. Please enter it again."):
        super().__init__(message)


def get_integration(slug, project_id):
    """Return the project's integration row or raise IntegrationNotConfigured."""
    integration = ProjectCyberneticsDataIntegration.objects.filter(workspace__slug=slug, project_id=project_id).first()
    if integration is None:
        raise IntegrationNotConfigured()
    return integration


def client_for(integration):
    """Build a client for an enabled integration, decrypting its stored token.

    Raises IntegrationNotConfigured if disabled globally/per project, TokenUnreadable if undecryptable.
    """
    if not settings.CYBERNETICS_DATA_ENABLED or not integration.is_enabled:
        raise IntegrationNotConfigured("Cybernetics Data is disabled for this project")
    try:
        token = decrypt_token(integration.api_token_encrypted)
    except TokenDecryptionError:
        raise TokenUnreadable()
    return CyberneticsDataClient(integration.base_url, token)


def get_client(slug, project_id):
    """Return ``(integration, client)`` for a workspace slug + project id."""
    integration = get_integration(slug, project_id)
    return integration, client_for(integration)


def build_deep_link(base_url, base_id, table_id, record_id=None, view_id=None):
    """Build a URL that opens the table (and optionally view/record) in the Cybernetics-Data web UI."""
    url = f"{base_url.rstrip('/')}/base/{quote(base_id, safe='')}/table/{quote(table_id, safe='')}"
    if view_id:
        url += f"/{quote(view_id, safe='')}"
    if record_id:
        url += f"?recordId={quote(record_id, safe='')}"
    return url


def _cache_key(integration, kind, *args):
    """Build a cache key scoped to the project and to the current base URL + token.

    Hashing base_url with the token fingerprint means changing either invalidates cached entries.
    """
    namespace = hashlib.sha256(f"{integration.base_url}|{integration.token_fingerprint}".encode()).hexdigest()[:16]
    suffix = ":".join(str(a) for a in args)
    return f"cyb:{integration.project_id}:{namespace}:{kind}:{suffix}"


def _cached(integration, kind, args, loader):
    """Return the cached value for (kind, args), calling ``loader`` and caching it for CACHE_TTL[kind] on a miss."""
    key = _cache_key(integration, kind, *args)
    value = cache.get(key)
    if value is None:
        value = loader()
        cache.set(key, value, CACHE_TTL[kind])
    return value


def verify_connection(client):
    """Probe the token: bases → tables → records. Returns a result dict."""
    bases = []
    try:
        # Probe one base/table/record only; enough to exercise each read scope
        bases = client.list_bases()
        if bases:
            tables = client.list_tables(bases[0]["id"])
            if tables:
                client.list_records(tables[0]["id"], take=1)
    except CyberneticsUnauthorized as exc:
        return {"status": "unauthorized", "message": exc.message, "bases_visible": 0}
    except CyberneticsForbidden as exc:
        return {
            "status": "forbidden",
            "message": f"The token is missing a read scope: {exc.message}",
            "bases_visible": len(bases),
        }
    except CyberneticsNotFound as exc:
        return {"status": "error", "message": exc.message, "bases_visible": 0}
    except CyberneticsDataError as exc:
        status = "unreachable" if isinstance(exc, CyberneticsUnreachable) else "error"
        return {"status": status, "message": exc.message, "bases_visible": 0}
    return {"status": "ok", "message": "", "bases_visible": len(bases)}


def _shape_field(field):
    """Reshape an upstream field into the API schema, keeping only a light subset of its options."""
    options = field.get("options") or {}
    lite = {}
    if isinstance(options.get("choices"), list):
        lite["choices"] = [{"name": c.get("name"), "color": c.get("color")} for c in options["choices"][:100]]
    if options.get("foreignTableId"):
        lite["foreign_table_id"] = options["foreignTableId"]
    if options.get("formatting"):
        lite["formatting"] = options["formatting"]
    return {
        "id": field.get("id"),
        "name": field.get("name"),
        "type": field.get("type"),
        "is_primary": bool(field.get("isPrimary")),
        "is_lookup": bool(field.get("isLookup")),
        "cell_value_type": field.get("cellValueType"),
        "is_multiple": bool(field.get("isMultipleCellValue")),
        "options_lite": lite,
    }


def _shape_record(record):
    """Reshape an upstream record into the API response format."""
    return {
        "id": record.get("id"),
        "name": record.get("name") or "",
        "fields": record.get("fields") or {},
        "auto_number": record.get("autoNumber"),
        "created_time": record.get("createdTime"),
        "last_modified_time": record.get("lastModifiedTime"),
    }


def list_databases(integration, client):
    """Return accessible bases grouped by space (``[{"space": {...}, "bases": [...]}]``), cached."""

    def load():
        bases = client.list_bases()
        try:
            space_names = {s.get("id"): s.get("name") for s in client.list_spaces()}
        except (CyberneticsForbidden, CyberneticsNotFound):
            # Space names are cosmetic; tokens without space scope still get their bases
            space_names = {}
        groups = {}
        for base in bases:
            space_id = base.get("spaceId") or ""
            group = groups.setdefault(
                space_id,
                {"space": {"id": space_id, "name": space_names.get(space_id) or ""}, "bases": []},
            )
            group["bases"].append({"id": base.get("id"), "name": base.get("name"), "icon": base.get("icon")})
        return list(groups.values())

    return _cached(integration, "databases", (), load)


def list_tables(integration, client, base_id):
    """Return the tables of a base in API format, cached."""

    def load():
        return [
            {
                "id": t.get("id"),
                "name": t.get("name"),
                "icon": t.get("icon"),
                "description": t.get("description") or "",
                "default_view_id": t.get("defaultViewId") or "",
            }
            for t in client.list_tables(base_id)
        ]

    return _cached(integration, "tables", (base_id,), load)


def get_table(integration, client, base_id, table_id):
    """Fetch a table through its base — also proves the table belongs to the base."""
    return _cached(integration, "table", (base_id, table_id), lambda: client.get_table(base_id, table_id))


def get_base(integration, client, base_id):
    """Return upstream base metadata, cached."""
    return _cached(integration, "base", (base_id,), lambda: client.get_base(base_id))


def get_schema(integration, client, base_id, table_id, view_id=None):
    """Return ``{"fields", "views"}`` for a table, cached per table/view."""
    # Called first so a table id that doesn't belong to base_id is rejected before loading the schema
    get_table(integration, client, base_id, table_id)

    def load():
        fields = [_shape_field(f) for f in client.list_fields(table_id, view_id)]
        views = [{"id": v.get("id"), "name": v.get("name"), "type": v.get("type")} for v in client.list_views(table_id)]
        return {"fields": fields, "views": views}

    return _cached(integration, "schema", (table_id, view_id or ""), load)


def primary_field_id(schema):
    """Return the id of the schema's primary field, or None."""
    return next((f["id"] for f in schema["fields"] if f["is_primary"]), None)


def list_records(
    integration, client, base_id, table_id, *, take, skip, view_id, search, search_field, filter_, order_by, with_total
):
    """Return a page of shaped records (text cell format), plus ``total`` when ``with_total``.

    The schema lookup also validates base/table ownership and limits the projection to its fields.
    """
    schema = get_schema(integration, client, base_id, table_id, view_id)
    projection = [f["id"] for f in schema["fields"]]
    data = client.list_records(
        table_id,
        take=take,
        skip=skip,
        view_id=view_id,
        search=search,
        search_field=search_field,
        filter_=filter_,
        order_by=order_by,
        projection=projection,
        cell_format="text",
    )
    result = {"records": [_shape_record(r) for r in data["records"]], "take": take, "skip": skip}
    if with_total:
        result["total"] = client.row_count(
            table_id, view_id=view_id, search=search, search_field=search_field, filter_=filter_
        )
    return result


def get_record(integration, client, base_id, table_id, record_id, cell_format="json"):
    """Return a single shaped record together with the table fields and a deep link."""
    schema = get_schema(integration, client, base_id, table_id)
    record = client.get_record(table_id, record_id, cell_format=cell_format)
    return {
        "record": _shape_record(record),
        "fields": schema["fields"],
        "deep_link": build_deep_link(integration.base_url, base_id, table_id, record_id),
    }


def _truncate(value):
    """Stringify a cell value and cut it to PREVIEW_VALUE_LENGTH (None -> "")."""
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    return text[:PREVIEW_VALUE_LENGTH]


def build_snapshot(integration, client, base_id, table_id, record_id, view_id=""):
    """Return the model fields for an ``IssueCyberneticsRecord`` row."""
    table = get_table(integration, client, base_id, table_id)
    base = get_base(integration, client, base_id)
    schema = get_schema(integration, client, base_id, table_id)
    primary_id = primary_field_id(schema)
    preview_fields = [f for f in schema["fields"] if not f["is_primary"] and f["type"] not in _PREVIEW_EXCLUDED_TYPES][
        :PREVIEW_FIELD_COUNT
    ]
    # Fetch only the primary field and the preview fields
    projection = [fid for fid in [primary_id, *[f["id"] for f in preview_fields]] if fid]
    record = client.get_record(table_id, record_id, cell_format="text", projection=projection)
    values = record.get("fields") or {}
    preview = {
        f["name"]: _truncate(values.get(f["id"])) for f in preview_fields if values.get(f["id"]) not in (None, "")
    }
    # Lengths are truncated to fit the IssueCyberneticsRecord column sizes
    return {
        "space_id": base.get("spaceId") or "",
        "base_id": base_id,
        "table_id": table_id,
        "record_id": record_id,
        "view_id": view_id or "",
        "record_name": _truncate(record.get("name") or values.get(primary_id))[:512],
        "base_name": (base.get("name") or "")[:255],
        "table_name": (table.get("name") or "")[:255],
        "primary_field_id": primary_id or "",
        "preview": preview,
        "source_url": build_deep_link(integration.base_url, base_id, table_id, record_id),
    }
