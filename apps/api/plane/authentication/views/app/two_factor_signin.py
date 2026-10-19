# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The code step of a two-factor password sign-in to the web app.

Routes: ``POST /auth/sign-in/two-factor/`` (form POST: ``code``, ``next_path``;
logs in and redirects like ``/auth/sign-in/``) and
``POST /auth/sign-in/two-factor/resend/`` (JSON). Both act on the challenge that
``SignInAuthEndpoint`` stored in the session.
"""

# Django imports
from django.http import HttpResponseRedirect
from django.views import View

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.authentication.provider.credentials.two_factor import TwoFactorEmailProvider
from plane.authentication.rate_limit import AuthenticationThrottle, authentication_throttle_allows
from plane.authentication.utils.host import base_host
from plane.authentication.utils.login import user_login
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.two_factor_signin import complete_challenge, resend_challenge
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.utils.path_validator import get_safe_redirect_url


class SignInTwoFactorEndpoint(View):
    """Check the emailed code, then log in and redirect (form POST)."""

    def post(self, request):
        """Redirects to ``next_path`` (or the default path) on success, back to sign-in with an error otherwise."""
        next_path = request.POST.get("next_path")
        try:
            if not authentication_throttle_allows(request):
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["RATE_LIMIT_EXCEEDED"],
                    error_message="RATE_LIMIT_EXCEEDED",
                )
            user, challenge = complete_challenge(request, "app", request.POST.get("code", ""))
            provider = TwoFactorEmailProvider(request=request, user=user, callback=post_user_auth_workflow)
            user = provider.authenticate()
            user_login(request=request, user=user, is_app=True)
            path = next_path or challenge.get("next_path") or get_redirection_path(user=user)
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=path,
                params={},
            )
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=e.get_error_dict(),
            )
            return HttpResponseRedirect(url)


class SignInTwoFactorResendEndpoint(APIView):
    """Email a new code for the session's challenge (JSON)."""

    permission_classes = [AllowAny]
    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """200 ``{}`` when a new code was sent; 400 with an auth error otherwise."""
        try:
            resend_challenge(request, "app")
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        return Response({}, status=status.HTTP_200_OK)
