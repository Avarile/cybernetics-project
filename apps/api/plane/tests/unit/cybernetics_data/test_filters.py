# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.utils.cybernetics_data.filters``.

These validators sanitise user-supplied query params (ids, filter JSON, sort, search, paging)
before they are forwarded to Teable, so the tests focus on rejecting malformed or abusive input.
"""

import json

import pytest

from plane.utils.cybernetics_data.filters import (
    ID_PREFIXES,
    MAX_FILTER_CONDITIONS,
    MAX_ORDER_ITEMS,
    MAX_SEARCH_LENGTH,
    QueryValidationError,
    parse_filter,
    parse_int,
    parse_order_by,
    parse_search,
    validate_id,
)


def _cond(field="fldAAAAAAAA", operator="is", value="x"):
    """Build a single Teable filter condition."""
    return {"fieldId": field, "operator": operator, "value": value}


def _nested(depth):
    """A filter whose innermost set sits at ``depth`` (the root is depth 1)."""
    node = {"conjunction": "and", "filterSet": [_cond()]}
    for _ in range(depth - 1):
        node = {"conjunction": "and", "filterSet": [node]}
    return node


@pytest.mark.unit
class TestValidateId:
    """``validate_id``: Teable ids must be ``<kind prefix>`` + 8-32 ASCII alphanumerics."""

    @pytest.mark.parametrize("kind,prefix", sorted(ID_PREFIXES.items()))
    def test_every_kind(self, kind, prefix):
        value = f"{prefix}AbCd1234"
        assert validate_id(value, kind) == value

    def test_prefixes(self):
        assert ID_PREFIXES == {
            "space": "spc",
            "base": "bse",
            "table": "tbl",
            "field": "fld",
            "view": "viw",
            "record": "rec",
        }

    def test_wrong_prefix(self):
        with pytest.raises(QueryValidationError, match="Invalid base id"):
            validate_id("tblAAAAAAAA", "base")

    @pytest.mark.parametrize("length,valid", [(7, False), (8, True), (32, True), (33, False)])
    def test_body_length(self, length, valid):
        value = "rec" + "A" * length
        if valid:
            assert validate_id(value, "record") == value
        else:
            with pytest.raises(QueryValidationError):
                validate_id(value, "record")

    @pytest.mark.parametrize(
        "value",
        ["bse", "bseAAAA-BBBB", "bseAAAA_BBBB", "bseAAAA BBBB", "bseAAAAAAAÄ", 123, None],
    )
    def test_invalid_body(self, value):
        """Separators, whitespace, non-ASCII letters and non-string values are rejected."""
        with pytest.raises(QueryValidationError):
            validate_id(value, "base")

    @pytest.mark.xfail(
        reason="_ID_BODY uses `$`, which also matches before a trailing newline, so 'bseAAAAAAAA\\n' "
        "is accepted; it should use `\\Z` or re.fullmatch",
        strict=True,
    )
    def test_trailing_newline_rejected(self):
        """Documents a known gap (strict xfail): a trailing newline currently passes validation."""
        with pytest.raises(QueryValidationError):
            validate_id("bseAAAAAAAA\n", "base")

    @pytest.mark.parametrize("value", ["bse../../x", "bseAAAA/BBBB", "bse%2e%2e%2fxxxx", "../bseAAAAAAAA"])
    def test_path_traversal(self, value):
        """Ids that could alter the upstream URL path are rejected."""
        with pytest.raises(QueryValidationError):
            validate_id(value, "base")


@pytest.mark.unit
class TestFilterValues:
    """Allowed shapes and size limits for a condition's ``value``."""

    @pytest.mark.parametrize("value", ["x", "", 1, 1.5, True, False, None, "x" * 1000])
    def test_scalars(self, value):
        assert parse_filter({"filterSet": [_cond(value=value)]})["filterSet"][0]["value"] == value

    def test_string_too_long(self):
        with pytest.raises(QueryValidationError, match="too long"):
            parse_filter({"filterSet": [_cond(value="x" * 1001)]})

    def test_list(self):
        """List values are capped at 50 items."""
        assert parse_filter({"filterSet": [_cond(operator="isAnyOf", value=["a"] * 50)]}) is not None
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(operator="isAnyOf", value=["a"] * 51)]})

    def test_list_with_non_scalar(self):
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(operator="isAnyOf", value=["a", ["b"]])]})

    def test_dict(self):
        """Dict values (e.g. date filters) are allowed with at most 6 keys."""
        date = {"mode": "exactDate", "exactDate": "2026-01-01", "timeZone": "UTC"}
        assert parse_filter({"filterSet": [_cond(operator="isAfter", value=date)]})["filterSet"][0]["value"] == date
        six = {f"k{i}": i for i in range(6)}
        assert parse_filter({"filterSet": [_cond(value=six)]}) is not None
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(value={f"k{i}": i for i in range(7)})]})

    def test_nested_dict(self):
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(value={"a": {"b": 1}})]})

    def test_unsupported_type(self):
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(value=object())]})


@pytest.mark.unit
class TestParseFilter:
    """``parse_filter``: structure, operator whitelist, depth and size limits."""

    @pytest.mark.parametrize("raw", [None, "", json.dumps({"conjunction": "and", "filterSet": []})])
    def test_empty(self, raw):
        """Missing input or an empty root filter set means "no filter"."""
        assert parse_filter(raw) is None

    def test_default_conjunction(self):
        assert parse_filter(json.dumps({"filterSet": [_cond()]})) == {"conjunction": "and", "filterSet": [_cond()]}

    def test_invalid_conjunction(self):
        with pytest.raises(QueryValidationError, match="conjunction"):
            parse_filter({"conjunction": "xor", "filterSet": [_cond()]})

    @pytest.mark.parametrize("raw", [{"conjunction": "and"}, {"filterSet": "x"}, {"filterSet": {}}])
    def test_filter_set_missing_or_not_list(self, raw):
        with pytest.raises(QueryValidationError, match="filterSet"):
            parse_filter(raw)

    @pytest.mark.parametrize("raw", ["not json", "[]", "1", "null"])
    def test_invalid_json_or_root(self, raw):
        with pytest.raises(QueryValidationError):
            parse_filter(raw)

    def test_non_dict_item(self):
        with pytest.raises(QueryValidationError, match="condition"):
            parse_filter({"filterSet": ["x"]})

    def test_unknown_operator(self):
        with pytest.raises(QueryValidationError, match="operator"):
            parse_filter({"filterSet": [_cond(operator="drop table")]})

    def test_invalid_field_id(self):
        with pytest.raises(QueryValidationError):
            parse_filter({"filterSet": [_cond(field="tblAAAAAAAA")]})

    def test_strips_unknown_keys(self):
        """Only whitelisted keys are forwarded upstream."""
        raw = {"conjunction": "or", "evil": 1, "filterSet": [{**_cond(), "evil": 1}]}
        assert parse_filter(json.dumps(raw)) == {"conjunction": "or", "filterSet": [_cond()]}

    def test_valid_nested(self):
        raw = {
            "conjunction": "or",
            "filterSet": [
                _cond(),
                {"conjunction": "and", "filterSet": [_cond(operator="isEmpty", value=None)]},
            ],
        }
        assert parse_filter(json.dumps(raw)) == raw

    def test_depth_limit(self):
        """Nesting deeper than 3 levels is rejected."""
        assert parse_filter(_nested(3)) is not None
        with pytest.raises(QueryValidationError, match="deeply"):
            parse_filter(_nested(4))

    def test_condition_limit_counts_nested_sets(self):
        """``MAX_FILTER_CONDITIONS`` applies to the total across nested sets."""
        half = MAX_FILTER_CONDITIONS // 2
        at_limit = {"filterSet": [_cond()] * half + [{"filterSet": [_cond()] * half}]}
        assert parse_filter(at_limit) is not None
        over = {"filterSet": [_cond()] * half + [{"filterSet": [_cond()] * (half + 1)}]}
        with pytest.raises(QueryValidationError, match="Too many"):
            parse_filter(over)

    def test_accepts_dict(self):
        assert parse_filter({"filterSet": [_cond()]}) == {"conjunction": "and", "filterSet": [_cond()]}

    def test_empty_nested_set_is_kept(self):
        # Only an empty *root* set collapses to None.
        raw = {"filterSet": [{"conjunction": "and", "filterSet": []}]}
        assert parse_filter(raw) == {"conjunction": "and", "filterSet": [{"conjunction": "and", "filterSet": []}]}


@pytest.mark.unit
class TestParseOrderBy:
    """``parse_order_by``: normalises sort items to Teable's ``{fieldId, order}`` shape."""

    def test_snake_and_camel_case(self):
        raw = json.dumps([{"field_id": "fldAAAAAAAA", "order": "desc"}, {"fieldId": "fldBBBBBBBB", "order": "asc"}])
        assert parse_order_by(raw) == [
            {"fieldId": "fldAAAAAAAA", "order": "desc"},
            {"fieldId": "fldBBBBBBBB", "order": "asc"},
        ]

    def test_default_order_is_asc(self):
        assert parse_order_by([{"field_id": "fldAAAAAAAA"}]) == [{"fieldId": "fldAAAAAAAA", "order": "asc"}]

    def test_invalid_order(self):
        with pytest.raises(QueryValidationError, match="sort order"):
            parse_order_by([{"field_id": "fldAAAAAAAA", "order": "sideways"}])

    def test_invalid_json(self):
        with pytest.raises(QueryValidationError, match="valid JSON"):
            parse_order_by("[{")

    @pytest.mark.parametrize("raw", ['{"field_id": "fldAAAAAAAA"}', '"x"', "1"])
    def test_not_a_list(self, raw):
        with pytest.raises(QueryValidationError):
            parse_order_by(raw)

    def test_too_many_items(self):
        items = [{"field_id": "fldAAAAAAAA"}] * MAX_ORDER_ITEMS
        assert len(parse_order_by(items)) == MAX_ORDER_ITEMS
        with pytest.raises(QueryValidationError):
            parse_order_by(items + [{"field_id": "fldAAAAAAAA"}])

    def test_non_dict_item(self):
        with pytest.raises(QueryValidationError, match="item"):
            parse_order_by(["fldAAAAAAAA"])

    def test_invalid_field(self):
        """Only field ids (``fld`` prefix) are accepted as sort keys."""
        with pytest.raises(QueryValidationError):
            parse_order_by([{"field_id": "recAAAAAAAA"}])

    @pytest.mark.parametrize("raw", [None, "", "[]", []])
    def test_empty(self, raw):
        assert parse_order_by(raw) is None


@pytest.mark.unit
class TestParseSearch:
    """``parse_search``: trims, blanks to None and caps the search length."""

    def test_trims(self):
        assert parse_search("  acme ") == "acme"

    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_blank(self, raw):
        assert parse_search(raw) is None

    def test_length_limit(self):
        assert parse_search("x" * MAX_SEARCH_LENGTH) == "x" * 200
        with pytest.raises(QueryValidationError):
            parse_search("x" * (MAX_SEARCH_LENGTH + 1))

    def test_non_string(self):
        assert parse_search(42) == "42"


@pytest.mark.unit
class TestParseInt:
    """``parse_int``: integer query params with default and min/max clamping."""

    @pytest.mark.parametrize("raw", [None, ""])
    def test_default(self, raw):
        assert parse_int(raw, 50, 1, 200) == 50

    @pytest.mark.parametrize("raw,expected", [("999", 200), ("-5", 1), ("0", 1), ("10", 10), (7, 7)])
    def test_clamped(self, raw, expected):
        assert parse_int(raw, 50, 1, 200) == expected

    @pytest.mark.parametrize("raw", ["abc", "1.5", "1e3", []])
    def test_invalid(self, raw):
        with pytest.raises(QueryValidationError):
            parse_int(raw, 50, 1, 200)
