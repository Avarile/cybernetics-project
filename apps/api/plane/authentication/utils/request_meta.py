# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Display helpers for two-factor emails and screens.

``get_request_meta`` describes the request behind a code or a settings change
(time in the user's timezone, IP, "Browser on OS") so the user can spot activity
that isn't theirs. It runs in the request and returns plain strings, because the
Celery worker that sends the email has no request.
"""

# Python imports
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Django imports
from django.utils import timezone

# Module imports
from plane.utils.ip_address import get_client_ip

# Checked in order: Edge and Opera also send "Chrome/", and Chrome also sends "Safari/"
_BROWSERS = (
    ("Edg", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("FxiOS/", "Firefox"),
    ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)

# iPhone/iPad user agents also contain "Mac OS X", and Android ones "Linux"
_SYSTEMS = (
    ("iPhone", "iOS"),
    ("iPad", "iOS"),
    ("Android", "Android"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
)

UNKNOWN_DEVICE = "Unknown device"


def describe_user_agent(user_agent):
    """Reduce a User-Agent header to "Browser on OS", or ``UNKNOWN_DEVICE`` if neither is recognised."""
    user_agent = user_agent or ""
    browser = next((name for marker, name in _BROWSERS if marker in user_agent), None)
    system = next((name for marker, name in _SYSTEMS if marker in user_agent), None)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system or UNKNOWN_DEVICE


def format_local_time(user, when=None):
    """Format ``when`` (default now) in the user's timezone, e.g. "20 Oct 2026, 09:17 (Australia/Sydney)"."""
    tz_name = getattr(user, "user_timezone", None) or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz_name, tz = "UTC", ZoneInfo("UTC")
    local = (when or timezone.now()).astimezone(tz)
    return f"{local.day} {local:%b %Y, %H:%M} ({tz_name})"


def get_request_meta(request, user):
    """Return ``{"time", "ip", "device"}`` describing ``request`` for a two-factor email."""
    return {
        "time": format_local_time(user),
        "ip": get_client_ip(request=request) or "Unknown",
        "device": describe_user_agent(request.META.get("HTTP_USER_AGENT", "")),
    }


def mask_email(email):
    """Hide most of the local part: "avarile@gmail.com" -> "a•••••e@gmail.com"."""
    at = email.rfind("@")
    if at <= 0:
        return email
    local, domain = email[:at], email[at:]
    if len(local) <= 2:
        return f"{local[0]}•••••{domain}"
    return f"{local[0]}•••••{local[-1]}{domain}"
