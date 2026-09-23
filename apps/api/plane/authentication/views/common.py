# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Shared auth endpoints: CSRF token, CSRF failure page and password change/set.

Routes: ``GET /auth/get-csrf-token/``, ``POST /auth/change-password/`` and
``POST /auth/set-password/`` (the latter two require an authenticated user).
"""

# Django imports
from django.shortcuts import render

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from zxcvbn import zxcvbn

## Module imports
from plane.app.serializers import UserSerializer
from plane.authentication.utils.login import user_login
from plane.db.models import User
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from django.middleware.csrf import get_token
from plane.utils.cache import invalidate_cache
from plane.authentication.utils.host import base_host


class CSRFTokenEndpoint(APIView):
    """Public endpoint returning a CSRF token so the frontends can POST the auth forms."""

    permission_classes = [AllowAny]

    def get(self, request):
        """Return ``{"csrf_token": ...}`` (also sets the CSRF cookie)."""
        # Generate a CSRF token
        csrf_token = get_token(request)
        # Return the CSRF token in a JSON response
        return Response({"csrf_token": str(csrf_token)}, status=status.HTTP_200_OK)


def csrf_failure(request, reason=""):
    """Custom CSRF failure view"""
    return render(
        request,
        "csrf_failure.html",
        {"reason": reason, "root_url": base_host(request=request)},
    )


class ChangePasswordEndpoint(APIView):
    """Change the current user's password."""

    def post(self, request):
        """Check the old password (unless it was auto-set), enforce strength (zxcvbn score >= 3), save and re-login.

        Re-login keeps the session valid after the password hash changes.
        """
        user = User.objects.get(pk=request.user.id)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset:
            old_password = request.data.get("old_password", False)
            if not old_password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                    error_message="MISSING_PASSWORD",
                    payload={"error": "Old password is missing"},
                )
                return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Get the new password
        new_password = request.data.get("new_password", False)

        if not new_password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                error_message="MISSING_PASSWORD",
                payload={"error": "Old or new password is missing"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset and not user.check_password(old_password):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INCORRECT_OLD_PASSWORD"],
                error_message="INCORRECT_OLD_PASSWORD",
                payload={"error": "Old password is not correct"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # check the password score
        results = zxcvbn(new_password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                error_message="PASSWORD_TOO_WEAK",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # set_password also hashes the password that the user will get
        user.set_password(new_password)
        user.is_password_autoset = False
        user.save()
        user_login(user=user, request=request, is_app=True)
        return Response({"message": "Password updated successfully"}, status=status.HTTP_200_OK)


class SetUserPasswordEndpoint(APIView):
    """Set a first real password for users whose password was auto-generated (OAuth/magic-code sign-ups)."""

    @invalidate_cache("/api/users/me/")
    def post(self, request):
        """Set the password if still auto-set and strong enough, re-login and return the serialized user.

        Invalidates the cached ``/api/users/me/`` response.
        """
        user = User.objects.get(pk=request.user.id)
        password = request.data.get("password", False)

        # If the user password is not autoset then return error
        if not user.is_password_autoset:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_ALREADY_SET"],
                error_message="PASSWORD_ALREADY_SET",
                payload={"error": "Your password is already set please change your password from profile"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Check password validation
        if not password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        results = zxcvbn(password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Set the user password
        user.set_password(password)
        user.is_password_autoset = False
        user.save()
        # Login the user as the session is invalidated
        user_login(user=user, request=request, is_app=True)
        # Return the user
        serializer = UserSerializer(user)
        return Response(serializer.data, status=status.HTTP_200_OK)
