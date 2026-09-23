# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Email check endpoint for the space (public project) login screen (``POST /auth/spaces/email-check/``).

Same contract as the app ``EmailCheckEndpoint``: returns whether the user exists
and whether to show the "MAGIC_CODE" or "CREDENTIAL" step.
"""

# Python imports
import os

# Django imports
from django.core.validators import validate_email
from django.core.exceptions import ValidationError

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

## Module imports
from plane.db.models import User
from plane.license.models import Instance
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.license.utils.instance_value import get_configuration_value


class EmailCheckSpaceEndpoint(APIView):
    """Public, throttled endpoint that decides the next login step for an email on the space frontend."""

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Validate ``email`` and return ``{"existing": bool, "status": "MAGIC_CODE" | "CREDENTIAL"}``."""
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST, ENABLE_MAGIC_LINK_LOGIN) = get_configuration_value(
            [
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST", "")},
                {
                    "key": "ENABLE_MAGIC_LINK_LOGIN",
                    "default": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "1"),
                },
            ]
        )

        smtp_configured = bool(EMAIL_HOST)
        is_magic_login_enabled = ENABLE_MAGIC_LINK_LOGIN == "1"

        email = request.data.get("email", False)

        # Return error if email is not present
        if not email:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_REQUIRED"],
                error_message="EMAIL_REQUIRED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        email = str(email).lower().strip()
        # Validate email
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        # Check if a user already exists with the given email
        existing_user = User.objects.filter(email=email).first()

        # If existing user
        # Existing users go to magic code only if they never set a password and magic login is available.
        if existing_user:
            # Return response
            return Response(
                {
                    "existing": True,
                    "status": (
                        "MAGIC_CODE"
                        if existing_user.is_password_autoset and smtp_configured and is_magic_login_enabled
                        else "CREDENTIAL"
                    ),
                },
                status=status.HTTP_200_OK,
            )
        # Else return response
        return Response(
            {
                "existing": False,
                "status": ("MAGIC_CODE" if smtp_configured and is_magic_login_enabled else "CREDENTIAL"),
            },
            status=status.HTTP_200_OK,
        )
