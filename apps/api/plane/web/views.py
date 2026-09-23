# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Plain Django views for the health check and robots.txt (see ``plane/web/urls.py``)."""

from django.http import HttpResponse, JsonResponse


def health_check(request):
    """Liveness probe: always returns ``{"status": "OK"}`` without touching the DB."""
    return JsonResponse({"status": "OK"})


def robots_txt(request):
    """Serve a robots.txt that disallows all crawlers from indexing the API."""
    return HttpResponse("User-agent: *\nDisallow: /", content_type="text/plain")
