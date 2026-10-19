# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The code step of a two-factor admin sign-in, and the admin login both sign-in paths end with.

Routes (under ``/api/instances/``, so they use the admin session cookie):
``admins/sign-in/two-factor/`` (form POST: ``code``; redirects to the admin app) and
``admins/sign-in/two-factor/resend/`` (JSON). Both act on the challenge
``InstanceAdminSignInEndpoint`` stored in the admin session.
"""

# Python imports
from urllib.parse import urlencode, urljoin

# Django imports
from django.http import HttpResponseRedirect
from django.utils import timezone
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
from plane.authentication.rate_limit import AuthenticationThrottle, authentication_throttle_allows
from plane.authentication.utils.host import base_host
from plane.authentication.utils.login import user_login
from plane.authentication.utils.two_factor_signin import complete_challenge, resend_challenge
from plane.license.models import Instance, InstanceAdmin
from plane.utils.cache import invalidate_cache
from plane.utils.ip_address import get_client_ip


def _error_redirect(request, name):
    exc = AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[name], error_message=name)
    return _redirect_with(request, exc)


def _redirect_with(request, exc):
    return HttpResponseRedirect(
        urljoin(base_host(request=request, is_admin=True), "?" + urlencode(exc.get_error_dict()))
    )


def complete_admin_login(request, user):
    """Record the sign-in on ``user``, start the admin session and redirect to the admin app."""
    user.is_active = True
    user.last_active = timezone.now()
    user.last_login_time = timezone.now()
    user.last_login_ip = get_client_ip(request=request)
    user.last_login_uagent = request.META.get("HTTP_USER_AGENT")
    user.token_updated_at = timezone.now()
    user.save()

    user_login(request=request, user=user, is_admin=True)
    url = urljoin(base_host(request=request, is_admin=True), "general/")
    return HttpResponseRedirect(url)


class InstanceAdminSignInTwoFactorEndpoint(View):
    """Check the emailed code and start the admin session (form POST)."""

    @invalidate_cache(path="/api/instances/", user=False)
    def post(self, request):
        """Redirects to the admin app on success, back to its sign-in page with an error code otherwise."""
        if not authentication_throttle_allows(request):
            return _error_redirect(request, "RATE_LIMIT_EXCEEDED")
        try:
            user, _ = complete_challenge(request, "admin", request.POST.get("code", ""))
        except AuthenticationException as e:
            return _redirect_with(request, e)

        # the account may have changed since the password step
        if not user.is_active:
            return _error_redirect(request, "ADMIN_USER_DEACTIVATED")
        instance = Instance.objects.first()
        if instance is None or not InstanceAdmin.objects.filter(instance=instance, user=user).exists():
            return _error_redirect(request, "ADMIN_AUTHENTICATION_FAILED")
        return complete_admin_login(request, user)


class InstanceAdminSignInTwoFactorResendEndpoint(APIView):
    """Email a new code for the admin session's challenge (JSON)."""

    permission_classes = [AllowAny]
    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """200 ``{}`` when a new code was sent; 400 with an auth error otherwise."""
        try:
            resend_challenge(request, "admin")
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        return Response({}, status=status.HTTP_200_OK)
