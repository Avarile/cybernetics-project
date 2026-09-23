# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared error handling for the Cybernetics-Data views.

Converts upstream client errors, throttling and query validation failures
into the app's standard ``error`` / ``error_code`` / ``error_message`` body.
"""

# Third party imports
from rest_framework import status
from rest_framework.exceptions import Throttled
from rest_framework.response import Response

# Module imports
from plane.utils.cybernetics_data.client import CyberneticsDataError
from plane.utils.cybernetics_data.filters import QueryValidationError
from plane.utils.error_codes import ERROR_CODES


def error_response(error_message, error, status_code, **extra):
    """Build a Cybernetics-Data error body.

    ``error_message`` is the ``ERROR_CODES`` key (e.g. ``CYBERNETICS_FORBIDDEN``),
    ``error`` the human readable message.
    """
    return Response(
        {
            "error": error,
            "error_code": ERROR_CODES[error_message],
            "error_message": error_message,
            **extra,
        },
        status=status_code,
    )


class CyberneticsDataErrorMixin:
    """Maps Cybernetics-Data failures to ``{"error", "error_code", "error_message"}``.

    Upstream 401s are never returned as 401 (see ``CyberneticsUnauthorized``).
    """

    def handle_exception(self, exc):
        """Translate Cybernetics-Data, throttle and validation exceptions; defer everything else to DRF."""
        if isinstance(exc, CyberneticsDataError):
            return error_response(exc.code, exc.message, exc.http_status)
        if isinstance(exc, Throttled):
            response = error_response(
                "CYBERNETICS_RATE_LIMITED",
                "Too many requests to Cybernetics Data. Please wait and try again.",
                status.HTTP_429_TOO_MANY_REQUESTS,
            )
            if exc.wait:
                response["Retry-After"] = str(int(exc.wait))
            return response
        if isinstance(exc, QueryValidationError):
            return error_response("CYBERNETICS_BAD_REQUEST", str(exc), status.HTTP_400_BAD_REQUEST)
        return super().handle_exception(exc)
