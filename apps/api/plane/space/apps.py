# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.space``, the public (published project) API."""

from django.apps import AppConfig


class SpaceConfig(AppConfig):
    """AppConfig for the space app."""

    name = "plane.space"
