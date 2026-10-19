# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Turning email two-factor authentication on and off from profile settings.

Routes (signed-in, JSON): ``POST /auth/two-factor/email/send-code/`` checks the
current password and emails a code; ``POST /auth/two-factor/email/enable/`` and
``.../disable/`` check that code and flip ``User.is_two_factor_email_enabled``.
"""

# Django imports
from django.db import transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.authentication.rate_limit import TwoFactorSetupThrottle
from plane.authentication.utils import verification_code
from plane.authentication.utils.host import base_host
from plane.authentication.utils.request_meta import get_request_meta
from plane.authentication.utils.two_factor_signin import smtp_configured
from plane.bgtasks.two_factor_email_task import two_factor_changed_email, two_factor_code_email
from plane.db.models import User
from plane.utils.cache import invalidate_cache

ACTIONS = ("enable", "disable")


def error_response(name, payload=None, status_code=status.HTTP_400_BAD_REQUEST):
    exc = AuthenticationException(
        error_code=AUTHENTICATION_ERROR_CODES[name],
        error_message=name,
        payload=payload or {},
    )
    return Response(exc.get_error_dict(), status=status_code)


def state_error(action, enabled):
    """Name of the error when ``action`` doesn't fit the current state, else None."""
    if action == "enable" and enabled:
        return "TWO_FACTOR_ALREADY_ENABLED"
    if action == "disable" and not enabled:
        return "TWO_FACTOR_NOT_ENABLED"
    return None


class TwoFactorEmailSendCodeEndpoint(APIView):
    """Step 1 of turning two-factor authentication on or off: re-check the password and email a code."""

    throttle_classes = [TwoFactorSetupThrottle]

    def post(self, request):
        """Body ``{action: "enable"|"disable", password}``; returns ``{token, expires_at}``."""
        action = request.data.get("action")
        password = request.data.get("password") or ""
        if action not in ACTIONS:
            return Response({"error": "action must be 'enable' or 'disable'"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.get(pk=request.user.id)
        # a code alone must not change 2FA: the password proves it's the owner, not just a live session
        if user.is_password_autoset:
            return error_response("TWO_FACTOR_PASSWORD_REQUIRED")
        if not smtp_configured():
            return error_response("SMTP_NOT_CONFIGURED")
        error = state_error(action, user.is_two_factor_email_enabled)
        if error:
            return error_response(error)
        if not password or not user.check_password(password):
            return error_response("INCORRECT_OLD_PASSWORD")

        token, code, expires_at = verification_code.issue(
            verification_code.PURPOSE_SETUP, {"user_id": str(user.id), "action": action}
        )
        two_factor_code_email.delay(
            user.email, code, action, get_request_meta(request, user), base_host(request=request, is_app=True)
        )
        return Response({"token": token, "expires_at": expires_at}, status=status.HTTP_200_OK)


class TwoFactorEmailConfirmEndpoint(APIView):
    """Step 2: check the emailed code and turn two-factor authentication on or off (``action``)."""

    action = None
    throttle_classes = [TwoFactorSetupThrottle]

    @invalidate_cache(path="/api/users/me/")
    def post(self, request):
        """Body ``{token, code}``; returns the new ``is_two_factor_email_enabled`` / ``two_factor_enabled_at``."""
        try:
            data = verification_code.verify(
                verification_code.PURPOSE_SETUP, request.data.get("token"), request.data.get("code")
            )
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        # a code issued to another user or for the other action doesn't count
        if data.get("user_id") != str(request.user.id) or data.get("action") != self.action:
            return error_response("INVALID_TWO_FACTOR_CODE")

        enable = self.action == "enable"
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.id)
            error = state_error(self.action, user.is_two_factor_email_enabled)
            if error:
                return error_response(error)
            user.is_two_factor_email_enabled = enable
            user.two_factor_enabled_at = timezone.now() if enable else None
            user.save(update_fields=["is_two_factor_email_enabled", "two_factor_enabled_at", "updated_at"])

        two_factor_changed_email.delay(
            user.email, enable, get_request_meta(request, user), base_host(request=request, is_app=True)
        )
        return Response(
            {
                "is_two_factor_email_enabled": user.is_two_factor_email_enabled,
                "two_factor_enabled_at": user.two_factor_enabled_at,
            },
            status=status.HTTP_200_OK,
        )


class TwoFactorEmailEnableEndpoint(TwoFactorEmailConfirmEndpoint):
    action = "enable"


class TwoFactorEmailDisableEndpoint(TwoFactorEmailConfirmEndpoint):
    action = "disable"
