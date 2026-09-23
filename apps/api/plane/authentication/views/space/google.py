# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Google OAuth views for the public space frontend (``/auth/spaces/google/`` and
``/auth/spaces/google/callback/``).

The initiate view stores the frontend host and a random ``state`` (CSRF protection) in
the session, then redirects to Google. The callback logs the user in (no invitation
processing) and redirects back to the validated ``next_path`` on the space frontend.
Errors are sent back to the frontend as auth error query params.
"""

# Python imports
import uuid

# Django import
from django.http import HttpResponseRedirect
from django.views import View
from django.utils.http import url_has_allowed_host_and_scheme

# Module imports
from plane.authentication.provider.oauth.google import GoogleOAuthProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path, get_allowed_hosts


class GoogleOauthInitiateSpaceEndpoint(View):
    """Start the Google OAuth flow for the public space frontend."""

    def get(self, request):
        """Save host and ``state`` in the session and redirect to the Google authorize URL."""
        request.session["host"] = base_host(request=request, is_space=True)
        next_path = request.GET.get("next_path")

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            state = uuid.uuid4().hex
            provider = GoogleOAuthProvider(request=request, state=state)
            request.session["state"] = state
            auth_url = provider.get_auth_url()
            return HttpResponseRedirect(auth_url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)


class GoogleCallbackSpaceEndpoint(View):
    """Handle the Google redirect back to Plane and log the user in."""

    def get(self, request):
        """Verify ``state``, exchange ``code`` via the provider, log the user in and redirect to the frontend."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        # NOTE: this local assignment shadows the imported ``base_host`` helper for the whole method,
        # so the ``base_host(request=...)`` calls below would try to call that str (or None) and raise TypeError.
        base_host = request.session.get("host")
        next_path = request.session.get("next_path")

        # Reject callbacks whose state doesn't match the one issued at initiate (CSRF).
        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GOOGLE_OAUTH_PROVIDER_ERROR"],
                error_message="GOOGLE_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GOOGLE_OAUTH_PROVIDER_ERROR"],
                error_message="GOOGLE_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
        try:
            provider = GoogleOAuthProvider(request=request, code=code)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
            # redirect to referer path
            next_path = validate_next_path(next_path=next_path)

            url = f"{base_host(request=request, is_space=True).rstrip('/')}{next_path}"
            if url_has_allowed_host_and_scheme(url, allowed_hosts=get_allowed_hosts()):
                return HttpResponseRedirect(url)
            else:
                return HttpResponseRedirect(base_host(request=request, is_space=True))
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
