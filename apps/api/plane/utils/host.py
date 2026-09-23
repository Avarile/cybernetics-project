# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Helpers to resolve the public base URL for redirects and the client IP.

Used by authentication flows and emails to build links to the web app, the
admin (god-mode) app or the public spaces app, based on Django settings.
"""

# Django imports
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip


def base_host(
    request: Request | HttpRequest,
    is_admin: bool = False,
    is_space: bool = False,
    is_app: bool = False,
) -> str:
    """Return the base URL (origin + optional base path) for the requested app.

    Despite taking ``request``, the value is derived purely from settings:
    WEB_URL/APP_BASE_URL, plus ADMIN_*/SPACE_* overrides when ``is_admin`` /
    ``is_space`` is set. Raises ImproperlyConfigured if no base URL is set.
    """
    # Calculate the base origin from request
    base_origin = settings.WEB_URL or settings.APP_BASE_URL

    if not base_origin:
        raise ImproperlyConfigured("APP_BASE_URL or WEB_URL is not set")

    # Admin redirection
    if is_admin:
        # Normalise the base path to the form "/path/" (default "/god-mode/")
        admin_base_path = getattr(settings, "ADMIN_BASE_PATH", None)
        if not isinstance(admin_base_path, str):
            admin_base_path = "/god-mode/"
        if not admin_base_path.startswith("/"):
            admin_base_path = "/" + admin_base_path
        if not admin_base_path.endswith("/"):
            admin_base_path += "/"

        if settings.ADMIN_BASE_URL:
            return settings.ADMIN_BASE_URL + admin_base_path
        else:
            return base_origin + admin_base_path

    # Space redirection
    if is_space:
        # Normalise the base path to the form "/path/" (default "/spaces/")
        space_base_path = getattr(settings, "SPACE_BASE_PATH", None)
        if not isinstance(space_base_path, str):
            space_base_path = "/spaces/"
        if not space_base_path.startswith("/"):
            space_base_path = "/" + space_base_path
        if not space_base_path.endswith("/"):
            space_base_path += "/"

        if settings.SPACE_BASE_URL:
            return settings.SPACE_BASE_URL + space_base_path
        else:
            return base_origin + space_base_path

    # App Redirection
    if is_app:
        if settings.APP_BASE_URL:
            return settings.APP_BASE_URL
        else:
            return base_origin

    return base_origin


def user_ip(request: Request | HttpRequest) -> str:
    """Return the client IP for ``request`` (see ``plane.utils.ip_address``)."""
    return get_client_ip(request=request)
