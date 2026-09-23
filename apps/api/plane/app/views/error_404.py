# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""JSON 404 handler (``handler404``) so unknown routes return an API-style error."""

# views.py
from django.http import JsonResponse


def custom_404_view(request, exception=None):
    """Return ``{"error": "Page not found."}`` with HTTP 404."""
    return JsonResponse({"error": "Page not found."}, status=404)
