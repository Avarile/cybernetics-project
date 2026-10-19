# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the two-factor emails and the request details shown in them.

Rendering only: nothing is sent. Pins that codes stay out of subjects and preheaders,
that code emails carry no links, and that every email uses the Cybernetics Projects brand.
"""

import re
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from plane.authentication.utils.request_meta import (
    UNKNOWN_DEVICE,
    describe_user_agent,
    format_local_time,
    mask_email,
)
from plane.bgtasks.two_factor_email_task import (
    BRAND_NAME,
    CODE_EMAILS,
    render_changed_email,
    render_code_email,
)

META = {"time": "20 Oct 2026, 09:17 (Australia/Sydney)", "ip": "203.0.113.24", "device": "Chrome on macOS"}
SITE = "https://projects.example.com"
CODE = "482913"


def _preheader(html):
    match = re.search(r'class="preheader".*?>(.*?)</span>', html, flags=re.DOTALL)
    return match.group(1)


@pytest.mark.unit
class TestCodeEmails:
    @pytest.mark.parametrize("purpose", sorted(CODE_EMAILS))
    def test_renders_code_in_body_only(self, purpose):
        subject, html = render_code_email("avarile@gmail.com", CODE, purpose, META, SITE)
        assert "482 913" in html
        assert "482" not in subject and "913" not in subject
        assert "482" not in _preheader(html)
        assert subject.endswith(f"– {BRAND_NAME}")

    @pytest.mark.parametrize("purpose", sorted(CODE_EMAILS))
    def test_has_no_links(self, purpose):
        _, html = render_code_email("avarile@gmail.com", CODE, purpose, META, SITE)
        assert "href" not in html

    def test_shows_request_details_masked_email_and_expiry(self):
        _, html = render_code_email("avarile@gmail.com", CODE, "signin", META, SITE)
        for value in META.values():
            assert value in html
        assert "a•••••e@gmail.com" in html
        assert "avarile@gmail.com" not in html
        assert "Expires in 10 minutes" in html
        assert "Plane" not in html

    def test_admin_sign_in_names_the_admin_console(self):
        subject, html = render_code_email("avarile@gmail.com", CODE, "admin_signin", META, SITE)
        assert "admin" in subject.lower()
        assert "admin console" in html

    def test_escapes_request_details(self):
        _, html = render_code_email("avarile@gmail.com", CODE, "signin", {**META, "device": "<script>x</script>"}, SITE)
        assert "<script>x</script>" not in html


@pytest.mark.unit
class TestChangedEmails:
    @pytest.mark.parametrize("enabled", [True, False])
    def test_links_to_reset_password(self, enabled):
        subject, html = render_changed_email("avarile@gmail.com", enabled, META, SITE)
        assert f'href="{SITE}/accounts/forgot-password/?email=avarile%40gmail.com"' in html
        assert ("turned on" if enabled else "turned off") in subject
        assert subject.endswith(f"– {BRAND_NAME}")

    def test_turned_off_has_warning(self):
        _, html = render_changed_email("avarile@gmail.com", False, META, SITE)
        assert "Wasn&#x27;t you?" in html or "Wasn't you?" in html


@pytest.mark.unit
class TestRequestMeta:
    @pytest.mark.parametrize(
        "user_agent, expected",
        [
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                "Chrome on macOS",
            ),
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
                "Edge on Windows",
            ),
            ("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"),
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            (
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
                "Chrome on Android",
            ),
            ("curl/8.5.0", UNKNOWN_DEVICE),
            ("", UNKNOWN_DEVICE),
        ],
    )
    def test_describe_user_agent(self, user_agent, expected):
        assert describe_user_agent(user_agent) == expected

    def test_format_local_time_uses_user_timezone(self):
        when = datetime(2026, 10, 19, 22, 17, tzinfo=timezone.utc)
        user = SimpleNamespace(user_timezone="Australia/Sydney")
        assert format_local_time(user, when) == "20 Oct 2026, 09:17 (Australia/Sydney)"

    def test_format_local_time_falls_back_to_utc(self):
        when = datetime(2026, 10, 19, 22, 17, tzinfo=timezone.utc)
        assert format_local_time(SimpleNamespace(user_timezone="Not/AZone"), when) == "19 Oct 2026, 22:17 (UTC)"

    @pytest.mark.parametrize(
        "email, expected",
        [("avarile@gmail.com", "a•••••e@gmail.com"), ("ab@x.io", "a•••••@x.io"), ("not-an-email", "not-an-email")],
    )
    def test_mask_email(self, email, expected):
        assert mask_email(email) == expected
