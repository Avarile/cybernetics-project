# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Email/password credential provider.

Used by the email sign-in/sign-up views (app and space). Honors the
ENABLE_EMAIL_PASSWORD instance setting.
"""

# Python imports
import os

# Module imports
from plane.authentication.adapter.credential import CredentialAdapter
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.db.models import User
from plane.license.utils.instance_value import get_configuration_value


class EmailProvider(CredentialAdapter):
    """Authenticates users with email (``key``) and password (``code``)."""

    provider = "email"

    def __init__(self, request, key=None, code=None, is_signup=False, callback=None):
        """Raise EMAIL_PASSWORD_AUTHENTICATION_DISABLED if email/password login is turned off for the instance."""
        super().__init__(request=request, provider=self.provider, callback=callback)
        self.key = key
        self.code = code
        self.is_signup = is_signup

        (ENABLE_EMAIL_PASSWORD,) = get_configuration_value([
            {
                "key": "ENABLE_EMAIL_PASSWORD",
                "default": os.environ.get("ENABLE_EMAIL_PASSWORD"),
            }
        ])

        if ENABLE_EMAIL_PASSWORD == "0":
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_PASSWORD_AUTHENTICATION_DISABLED"],
                error_message="EMAIL_PASSWORD_AUTHENTICATION_DISABLED",
            )

    def set_user_data(self):
        """Validate the credentials and populate ``user_data``.

        Sign-up: fails if the email is already registered. Sign-in: fails if the user
        does not exist or the password is wrong. The password itself is validated and
        set later in ``complete_login_or_signup``.
        """
        if self.is_signup:
            # Check if the user already exists
            if User.objects.filter(email=self.key).exists():
                self.logger.warning("User already exists")
                raise AuthenticationException(
                    error_message="USER_ALREADY_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                )

            super().set_user_data({
                "email": self.key,
                "user": {
                    "avatar": "",
                    "first_name": "",
                    "last_name": "",
                    "provider_id": "",
                    "is_password_autoset": False,
                },
            })
            return
        else:
            user = User.objects.filter(email=self.key).first()

            # User does not exists
            if not user:
                self.logger.warning("User does not exist")
                raise AuthenticationException(
                    error_message="USER_DOES_NOT_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                    payload={"email": self.key},
                )

            # Check user password
            if not user.check_password(self.code):
                self.logger.warning("Authentication failed - invalid credentials")
                raise AuthenticationException(
                    error_message=(
                        "AUTHENTICATION_FAILED_SIGN_UP" if self.is_signup else "AUTHENTICATION_FAILED_SIGN_IN"
                    ),
                    error_code=AUTHENTICATION_ERROR_CODES[
                        ("AUTHENTICATION_FAILED_SIGN_UP" if self.is_signup else "AUTHENTICATION_FAILED_SIGN_IN")
                    ],
                    payload={"email": self.key},
                )

            super().set_user_data({
                "email": self.key,
                "user": {
                    "avatar": "",
                    "first_name": "",
                    "last_name": "",
                    "provider_id": "",
                    "is_password_autoset": False,
                },
            })
            return
