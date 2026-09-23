# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Session authentication class used by the REST API views."""

from rest_framework.authentication import SessionAuthentication


class BaseSessionAuthentication(SessionAuthentication):
    """DRF session authentication that skips CSRF enforcement for API requests."""

    # Disable csrf for the rest apis
    def enforce_csrf(self, request):
        return
