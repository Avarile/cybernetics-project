# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom database-backed Django session model and session store.

Extends the default session with the owning ``user_id`` and client
``device_info`` so sessions can be listed/revoked per user, and uses longer
128-character session keys.
"""

# Python imports
import string

# Django imports
from django.contrib.sessions.backends.db import SessionStore as DBSessionStore
from django.contrib.sessions.base_session import AbstractBaseSession
from django.db import models
from django.utils.crypto import get_random_string

VALID_KEY_CHARS = string.ascii_lowercase + string.digits


class Session(AbstractBaseSession):
    """Session row stored in the ``sessions`` table, annotated with user id and device info."""

    device_info = models.JSONField(null=True, blank=True, default=None)
    session_key = models.CharField(max_length=128, primary_key=True)
    user_id = models.CharField(null=True, max_length=50, db_index=True)

    @classmethod
    def get_session_store_class(cls):
        """Tell Django which ``SessionStore`` class works with this model."""
        return SessionStore

    class Meta(AbstractBaseSession.Meta):
        db_table = "sessions"


class SessionStore(DBSessionStore):
    """DB session store backed by the custom ``Session`` model (referenced by ``SESSION_ENGINE``)."""

    @classmethod
    def get_model_class(cls):
        """Use the custom ``Session`` model instead of Django's default."""
        return Session

    def _get_new_session_key(self):
        """
        Return a new session key that is not present in the current backend.
        Override this method to use a custom session key generation mechanism.
        """
        while True:
            session_key = get_random_string(128, VALID_KEY_CHARS)
            if not self.exists(session_key):
                return session_key

    def create_model_instance(self, data):
        """Build the ``Session`` row, copying the auth user id and device info out of the session data."""
        obj = super().create_model_instance(data)
        try:
            user_id = data.get("_auth_user_id")
        except (ValueError, TypeError):
            user_id = None
        obj.user_id = user_id

        # Save the device info
        device_info = data.get("device_info")
        obj.device_info = device_info if isinstance(device_info, dict) else None
        return obj
