# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Credential provider for the last step of a two-factor password sign-in.

The password and the emailed code have already been checked (see
``plane.authentication.utils.two_factor_signin``); this provider only feeds the
user into ``complete_login_or_signup`` so the sign-in is recorded exactly like a
plain password sign-in (deactivation checks, login metadata, invite callback).
"""

# Module imports
from plane.authentication.adapter.credential import CredentialAdapter


class TwoFactorEmailProvider(CredentialAdapter):
    """Completes a password sign-in for ``user`` once its two-factor code was verified."""

    provider = "email"

    def __init__(self, request, user, callback=None):
        super().__init__(request=request, provider=self.provider, callback=callback)
        self.user = user

    def set_user_data(self):
        super().set_user_data(
            {
                "email": self.user.email,
                "user": {
                    "avatar": "",
                    "first_name": "",
                    "last_name": "",
                    "provider_id": "",
                    "is_password_autoset": False,
                },
            }
        )
