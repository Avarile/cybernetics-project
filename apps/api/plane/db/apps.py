# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.db``, the app that owns all core models and migrations."""

from django.apps import AppConfig


class DbConfig(AppConfig):
    """App config registering ``plane.db`` (app label ``db``)."""

    name = "plane.db"
