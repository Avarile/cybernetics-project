# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.tests`` (installed only by ``plane.settings.test``)."""

from django.apps import AppConfig


class ApiConfig(AppConfig):
    """AppConfig for the test package."""

    name = "plane.tests"
