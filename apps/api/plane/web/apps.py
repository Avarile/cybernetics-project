# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.web`` (health check and robots.txt endpoints)."""

from django.apps import AppConfig


class WebConfig(AppConfig):
    """App configuration for the ``plane.web`` app."""

    name = "plane.web"
