# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Validation of ids and query payloads forwarded to Cybernetics-Data."""

# Python imports
import json
import re

ID_PREFIXES = {
    "space": "spc",
    "base": "bse",
    "table": "tbl",
    "field": "fld",
    "view": "viw",
    "record": "rec",
}
_ID_BODY = re.compile(r"^[A-Za-z0-9]{8,32}$")

FILTER_OPERATORS = frozenset(
    {
        "is",
        "isNot",
        "contains",
        "doesNotContain",
        "isGreater",
        "isGreaterEqual",
        "isLess",
        "isLessEqual",
        "isEmpty",
        "isNotEmpty",
        "isAnyOf",
        "isNoneOf",
        "hasAnyOf",
        "hasAllOf",
        "hasNoneOf",
        "isExactly",
        "isNotExactly",
        "isWithIn",
        "isBefore",
        "isAfter",
        "isOnOrBefore",
        "isOnOrAfter",
    }
)
MAX_FILTER_DEPTH = 3
MAX_FILTER_CONDITIONS = 20
MAX_ORDER_ITEMS = 5
MAX_SEARCH_LENGTH = 200
_SCALARS = (str, int, float, bool, type(None))


class QueryValidationError(ValueError):
    pass


def validate_id(value, kind):
    """Return ``value`` if it is a well-formed Cybernetics-Data id of ``kind``."""
    prefix = ID_PREFIXES[kind]
    if not isinstance(value, str) or not value.startswith(prefix) or not _ID_BODY.match(value[len(prefix) :]):
        raise QueryValidationError(f"Invalid {kind} id")
    return value


def _validate_value(value):
    if isinstance(value, _SCALARS):
        if isinstance(value, str) and len(value) > 1000:
            raise QueryValidationError("Filter value is too long")
        return
    if isinstance(value, list):
        if len(value) > 50 or not all(isinstance(item, _SCALARS) for item in value):
            raise QueryValidationError("Invalid filter value list")
        return
    if isinstance(value, dict):
        # date filters: {"mode": "...", "exactDate": "...", "timeZone": "..."}
        if len(value) > 6 or not all(isinstance(k, str) and isinstance(v, _SCALARS) for k, v in value.items()):
            raise QueryValidationError("Invalid filter value object")
        return
    raise QueryValidationError("Invalid filter value")


def _validate_filter_set(node, depth, counter):
    if depth > MAX_FILTER_DEPTH:
        raise QueryValidationError("Filter is nested too deeply")
    if not isinstance(node, dict):
        raise QueryValidationError("Filter must be an object")
    conjunction = node.get("conjunction", "and")
    if conjunction not in ("and", "or"):
        raise QueryValidationError("Invalid filter conjunction")
    items = node.get("filterSet")
    if not isinstance(items, list):
        raise QueryValidationError("filterSet must be a list")
    clean = []
    for item in items:
        if isinstance(item, dict) and "filterSet" in item:
            clean.append(_validate_filter_set(item, depth + 1, counter))
            continue
        if not isinstance(item, dict):
            raise QueryValidationError("Invalid filter condition")
        counter[0] += 1
        if counter[0] > MAX_FILTER_CONDITIONS:
            raise QueryValidationError("Too many filter conditions")
        operator = item.get("operator")
        if operator not in FILTER_OPERATORS:
            raise QueryValidationError("Unsupported filter operator")
        value = item.get("value")
        _validate_value(value)
        clean.append({"fieldId": validate_id(item.get("fieldId"), "field"), "operator": operator, "value": value})
    return {"conjunction": conjunction, "filterSet": clean}


def parse_filter(raw):
    """Parse and validate a JSON filter string; returns a clean dict or None."""
    if raw in (None, ""):
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        raise QueryValidationError("filter must be valid JSON")
    result = _validate_filter_set(data, 1, [0])
    return result if result["filterSet"] else None


def parse_order_by(raw):
    """Parse ``[{"field_id"|"fieldId": "fld…", "order": "asc"|"desc"}]``."""
    if raw in (None, ""):
        return None
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        raise QueryValidationError("order_by must be valid JSON")
    if not isinstance(data, list) or len(data) > MAX_ORDER_ITEMS:
        raise QueryValidationError("order_by must be a short list")
    clean = []
    for item in data:
        if not isinstance(item, dict):
            raise QueryValidationError("Invalid order_by item")
        order = item.get("order", "asc")
        if order not in ("asc", "desc"):
            raise QueryValidationError("Invalid sort order")
        field_id = validate_id(item.get("field_id") or item.get("fieldId"), "field")
        clean.append({"fieldId": field_id, "order": order})
    return clean or None


def parse_search(raw):
    if not raw:
        return None
    value = str(raw).strip()
    if len(value) > MAX_SEARCH_LENGTH:
        raise QueryValidationError("Search term is too long")
    return value or None


def parse_int(raw, default, minimum, maximum):
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise QueryValidationError("Expected an integer")
    return max(minimum, min(value, maximum))
