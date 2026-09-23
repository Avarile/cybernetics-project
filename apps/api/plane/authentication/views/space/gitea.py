# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Gitea OAuth views for the public space frontend (``/auth/spaces/gitea/`` and
``/auth/spaces/gitea/callback/``).

The initiate view stores the frontend host, a random ``state`` (CSRF protection) and
``next_path`` in the session, then redirects to Gitea. The callback logs the user in (no
invitation processing) and redirects back to the validated ``next_path`` on the space
frontend. Errors are sent back to the frontend as auth error query params.
"""

# Python imports
import uuid
from urllib.parse import urlencode

# Django import
from django.http import HttpResponseRedirect
from django.views import View

# Module imports
from plane.authentication.provider.oauth.gitea import GiteaOAuthProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.path_validator import validate_next_path


class GiteaOauthInitiateSpaceEndpoint(View):
    """Start the Gitea OAuth flow for the public space frontend."""

    def get(self, request):
        """Save host/``state``/``next_path`` in the session and redirect to the Gitea authorize URL."""
        # Get host and next path
        request.session["host"] = base_host(request=request, is_space=True)
        next_path = request.GET.get("next_path")
        if next_path:
            request.session["next_path"] = str(validate_next_path(next_path))

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)

        try:
            state = uuid.uuid4().hex
            provider = GiteaOAuthProvider(request=request, state=state)
            request.session["state"] = state
            auth_url = provider.get_auth_url()
            return HttpResponseRedirect(auth_url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            if next_path:
                params["next_path"] = str(next_path)
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)


class GiteaCallbackSpaceEndpoint(View):
    """Handle the Gitea redirect back to Plane and log the user in."""

    def get(self, request):
        """Verify ``state``, exchange ``code`` via the provider, log the user in and redirect to the frontend."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        next_path = request.session.get("next_path")

        # Reject callbacks whose state doesn't match the one issued at initiate (CSRF).
        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)

        try:
            provider = GiteaOAuthProvider(request=request, code=code)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
            # Process workspace and project invitations
            # redirect to referer path
            url = (
                f"{base_host(request=request, is_space=True)}{str(validate_next_path(next_path)) if next_path else ''}"
            )
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)
