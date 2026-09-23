# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""API-key authentication for the public REST API (plane.api).

Clients send their token in the ``X-Api-Key`` header; it is matched against
active, non-expired ``APIToken`` rows belonging to active users.
"""

# Django imports
from django.utils import timezone
from django.db.models import Q

# Third party imports
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

# Module imports
from plane.db.models import APIToken


class APIKeyAuthentication(authentication.BaseAuthentication):
    """
    Authentication with an API Key
    """

    www_authenticate_realm = "api"
    media_type = "application/json"
    auth_header_name = "X-Api-Key"

    def get_api_token(self, request):
        """Return the raw API key from the X-Api-Key header, or None."""
        return request.headers.get(self.auth_header_name)

    def validate_api_token(self, token):
        """Look up an active, unexpired token owned by an active user.

        Updates ``last_used`` on success (DB write). Returns ``(user, token)``;
        raises AuthenticationFailed if no matching token exists.
        """
        try:
            api_token = APIToken.objects.get(
                # Token is valid if it has no expiry or expires in the future.
                Q(Q(expired_at__gt=timezone.now()) | Q(expired_at__isnull=True)),
                token=token,
                is_active=True,
                user__is_active=True,
            )
        except APIToken.DoesNotExist:
            raise AuthenticationFailed("Given API token is not valid")

        # save api token last used
        api_token.last_used = timezone.now()
        api_token.save(update_fields=["last_used"])
        return (api_token.user, api_token.token)

    def authenticate(self, request):
        """DRF hook: return ``(user, token)``, or None to let other authenticators try."""
        token = self.get_api_token(request=request)
        if not token:
            return None

        # Validate the API token
        user, token = self.validate_api_token(token)
        return user, token
