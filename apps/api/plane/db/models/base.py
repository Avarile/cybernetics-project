# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Abstract base model for all app models.

Provides a UUID primary key plus the audit fields from ``AuditModel``
(created/updated timestamps, created_by/updated_by, soft delete), and fills in
``created_by``/``updated_by`` automatically from the current request user.
"""

import uuid

# Django imports
from django.db import models

# Third party imports
from crum import get_current_user

# Module imports
from ..mixins import AuditModel


class BaseModel(AuditModel):
    """Abstract model with a UUID primary key and automatic user auditing on save."""

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)

    class Meta:
        abstract = True

    def save(self, *args, created_by_id=None, disable_auto_set_user=False, **kwargs):
        """Save the instance, stamping ``created_by``/``updated_by``.

        The user comes from ``crum.get_current_user()`` (the request user set by
        middleware). Pass ``created_by_id`` to set the creator explicitly (e.g.
        from background tasks), or ``disable_auto_set_user=True`` to leave the
        audit user fields untouched.
        """
        if not disable_auto_set_user:
            # Check if created_by_id is provided
            if created_by_id:
                self.created_by_id = created_by_id
            else:
                user = get_current_user()

                # No authenticated user (e.g. Celery task, management command):
                # note this clears any existing created_by/updated_by values
                if user is None or user.is_anonymous:
                    self.created_by = None
                    self.updated_by = None
                else:
                    # Check if the model is being created or updated
                    if self._state.adding:
                        # If creating, set created_by and leave updated_by as None
                        self.created_by = user
                        self.updated_by = None
                    else:
                        # If updating, set updated_by only
                        self.updated_by = user

        super(BaseModel, self).save(*args, **kwargs)

    def __str__(self):
        return str(self.id)
