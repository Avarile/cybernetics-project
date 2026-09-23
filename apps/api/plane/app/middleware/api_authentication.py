# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF authentication class that authenticates requests via the ``X-Api-Key`` header.

Looks up an active, non-expired ``APIToken`` belonging to an active user and
records its last-used timestamp.
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
        """Return the raw API key from the ``X-Api-Key`` request header (or None)."""
        return request.headers.get(self.auth_header_name)

    def validate_api_token(self, token):
        """Resolve ``token`` to an active APIToken and return ``(user, token)``.

        Raises AuthenticationFailed if the token is unknown, inactive, expired or
        belongs to an inactive user. Side effect: updates ``last_used``.
        """
        # Token is valid if it has no expiry or its expiry is in the future
        try:
            api_token = APIToken.objects.get(
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
        """DRF hook: return ``(user, token)`` or None when no API key header is sent.

        Returning None lets DRF fall through to the next authentication class.
        """
        token = self.get_api_token(request=request)
        if not token:
            return None

        # Validate the API token
        user, token = self.validate_api_token(token)
        return user, token
