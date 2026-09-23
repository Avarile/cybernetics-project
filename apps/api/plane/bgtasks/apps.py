# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.bgtasks`` (Celery background tasks)."""

from django.apps import AppConfig


class BgtasksConfig(AppConfig):
    """App configuration for the background tasks package."""

    name = "plane.bgtasks"
