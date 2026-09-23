# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes of the public (space) API, mounted under ``/api/public/`` in ``plane/urls.py``."""

from .intake import urlpatterns as intake_urls
from .issue import urlpatterns as issue_urls
from .project import urlpatterns as project_urls
from .asset import urlpatterns as asset_urls


urlpatterns = [*intake_urls, *issue_urls, *project_urls, *asset_urls]
