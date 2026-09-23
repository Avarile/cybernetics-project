# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django AppConfig for the ``plane.app`` package (the internal web-app API used by the frontend)."""

from django.apps import AppConfig


class AppApiConfig(AppConfig):
    """App configuration registering ``plane.app`` with Django."""
    name = "plane.app"
