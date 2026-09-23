# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for CSV-injection protection in the porter CSVFormatter.

Values and headers starting with a formula trigger (e.g. "=") must be prefixed with a
single quote so spreadsheet apps treat them as text.
"""

import csv
from io import StringIO

import pytest

from plane.utils.porters.formatters import CSVFormatter


def _read_rows(content):
    """Parse CSV text into a list of rows (row 0 is the header)."""
    return list(csv.reader(StringIO(content)))


@pytest.mark.unit
class TestPorterCSVFormatterSanitization:
    """CSV exports must not emit formula-triggering values, including in header rows."""

    def test_data_values_are_sanitized(self):
        """Cell values starting with "=" are quote-prefixed."""
        content = CSVFormatter().encode([{"name": "=1+2"}])
        rows = _read_rows(content)
        assert rows[1][0] == "'=1+2"

    def test_prettified_headers_are_sanitized(self):
        """Headers are prettified (title-cased, underscores to spaces) and then sanitized."""
        content = CSVFormatter().encode([{"=evil_header": "value"}])
        rows = _read_rows(content)
        assert rows[0][0] == "'=Evil Header"

    def test_raw_headers_are_sanitized(self):
        """With prettify_headers=False the raw key is still sanitized."""
        content = CSVFormatter(prettify_headers=False).encode([{"=evil": "value"}])
        rows = _read_rows(content)
        assert rows[0][0] == "'=evil"
