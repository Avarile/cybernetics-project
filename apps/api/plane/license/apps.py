# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.license`` (instance setup, instance admins and instance configuration)."""

from django.apps import AppConfig


class LicenseConfig(AppConfig):
    """AppConfig for the license (instance management) app."""

    name = "plane.license"
