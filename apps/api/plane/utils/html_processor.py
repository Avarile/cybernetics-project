# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Plain-text extraction from HTML, used by models (Issue, Page,
Draft, Sticky) to derive description_stripped from description_html.
"""

from io import StringIO
from html.parser import HTMLParser


class MLStripper(HTMLParser):
    """
    Markup Language Stripper

    HTMLParser subclass that discards tags and accumulates only text content.
    """

    def __init__(self):
        super().__init__()
        self.reset()
        self.strict = False
        self.convert_charrefs = True
        self.text = StringIO()

    def handle_data(self, d):
        self.text.write(d)

    def get_data(self):
        return self.text.getvalue()


def strip_tags(html):
    """Return ``html`` with all tags removed (entities are decoded)."""
    s = MLStripper()
    s.feed(html)
    return s.get_data()
