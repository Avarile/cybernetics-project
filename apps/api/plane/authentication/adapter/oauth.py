# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Base adapter for OAuth2 providers (Google, GitHub, GitLab, Gitea).

Handles the token exchange, user-info fetch and persistence of the provider
``Account`` (tokens and expiry); providers in ``plane.authentication.provider.oauth``
supply the URLs and map the provider payload into ``user_data``.
"""

# Python imports
import requests
from django.db import DatabaseError, IntegrityError

# Django imports
from django.utils import timezone

from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)

# Module imports
from plane.db.models import Account
from plane.utils.exception_logger import log_exception

from .base import Adapter


class OauthAdapter(Adapter):
    """Common OAuth2 authorization-code flow; subclasses implement ``set_token_data``/``set_user_data``."""

    def __init__(
        self,
        request,
        provider,
        client_id,
        scope,
        redirect_uri,
        auth_url,
        token_url,
        userinfo_url,
        client_secret=None,
        code=None,
        callback=None,
    ):
        super().__init__(request=request, provider=provider, callback=callback)
        self.client_id = client_id
        self.scope = scope
        self.redirect_uri = redirect_uri
        self.auth_url = auth_url
        self.token_url = token_url
        self.userinfo_url = userinfo_url
        self.client_secret = client_secret
        self.code = code

    def authentication_error_code(self):
        """Return the provider-specific error key used when a call to the provider fails."""
        if self.provider == "google":
            return "GOOGLE_OAUTH_PROVIDER_ERROR"
        elif self.provider == "github":
            return "GITHUB_OAUTH_PROVIDER_ERROR"
        elif self.provider == "gitlab":
            return "GITLAB_OAUTH_PROVIDER_ERROR"
        elif self.provider == "gitea":
            return "GITEA_OAUTH_PROVIDER_ERROR"
        else:
            return "OAUTH_NOT_CONFIGURED"

    def get_auth_url(self):
        return self.auth_url

    def get_token_url(self):
        return self.token_url

    def get_user_info_url(self):
        return self.userinfo_url

    def authenticate(self):
        """Exchange the code for tokens, load the user profile, then log in or sign up."""
        self.set_token_data()
        self.set_user_data()
        return self.complete_login_or_signup()

    def get_user_token(self, data, headers=None):
        """POST ``data`` to the token endpoint and return the JSON token payload; raise a provider error on failure."""
        try:
            headers = headers or {}
            response = requests.post(self.get_token_url(), data=data, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            self.logger.warning("Error getting user token")
            code = self.authentication_error_code()
            raise AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[code], error_message=str(code))

    def get_user_response(self):
        """GET the user-info endpoint with the bearer access token and return the JSON profile."""
        try:
            headers = {"Authorization": f"Bearer {self.token_data.get('access_token')}"}
            response = requests.get(self.get_user_info_url(), headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            self.logger.warning(
                "Error getting user response",
                extra={
                    "headers": headers,
                },
            )
            code = self.authentication_error_code()
            raise AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[code], error_message=str(code))

    def set_user_data(self, data):
        self.user_data = data

    def create_update_account(self, user):
        """Upsert the ``Account`` row linking ``user`` to this provider and store the latest tokens.

        Database errors are logged and swallowed so they do not block the login.
        """
        try:
            # Check if the account already exists
            account = Account.objects.filter(
                user=user,
                provider=self.provider,
                provider_account_id=self.user_data.get("user").get("provider_id"),
            ).first()
            # Update the account if it exists
            if account:
                account.access_token = self.token_data.get("access_token")
                account.refresh_token = self.token_data.get("refresh_token", None)
                account.access_token_expired_at = self.token_data.get("access_token_expired_at")
                account.refresh_token_expired_at = self.token_data.get("refresh_token_expired_at")
                account.last_connected_at = timezone.now()
                account.id_token = self.token_data.get("id_token", "")
                account.save()
            # Create a new account if it does not exist
            else:
                Account.objects.create(
                    user=user,
                    provider=self.provider,
                    provider_account_id=self.user_data.get("user", {}).get("provider_id"),
                    access_token=self.token_data.get("access_token"),
                    refresh_token=self.token_data.get("refresh_token", None),
                    access_token_expired_at=self.token_data.get("access_token_expired_at"),
                    refresh_token_expired_at=self.token_data.get("refresh_token_expired_at"),
                    last_connected_at=timezone.now(),
                    id_token=self.token_data.get("id_token", ""),
                )
        except (DatabaseError, IntegrityError) as e:
            log_exception(e)
