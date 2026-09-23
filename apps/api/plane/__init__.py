# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Top-level ``plane`` package.

Importing the Celery app here ensures it is loaded whenever Django starts, so
``@shared_task`` decorators across the project bind to it.
"""

from .celery import app as celery_app

__all__ = ("celery_app",)
