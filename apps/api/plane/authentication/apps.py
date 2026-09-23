# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app config for ``plane.authentication`` (sign-in/sign-up, OAuth, sessions)."""

from django.apps import AppConfig


class AuthConfig(AppConfig):
    """App configuration for the authentication package."""

    name = "plane.authentication"
