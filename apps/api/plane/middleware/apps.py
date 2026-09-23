# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.middleware``."""

from django.apps import AppConfig


class Middleware(AppConfig):
    """AppConfig for the middleware package."""

    name = "plane.middleware"
