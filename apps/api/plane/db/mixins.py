# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Reusable abstract model bases and mixins for ``plane.db`` models.

Provides created/updated timestamps and user audit fields, soft deletion
(``deleted_at`` plus a manager that hides deleted rows and a background task
that cascades the soft delete), and ``ChangeTrackerMixin`` for detecting
which fields changed between load and save.
"""

# Type imports
from typing import Any

# Django imports
from django.db import models
from django.utils import timezone

# Module imports
from plane.bgtasks.deletion_task import soft_delete_related_objects


class TimeAuditModel(models.Model):
    """Abstract base adding ``created_at`` / ``updated_at`` timestamps."""

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Last Modified At")

    class Meta:
        abstract = True


class UserAuditModel(models.Model):
    """Abstract base adding ``created_by`` / ``updated_by`` user foreign keys (nullable, SET_NULL)."""

    created_by = models.ForeignKey(
        "db.User",
        on_delete=models.SET_NULL,
        # %(class)s expands to the concrete model name so reverse accessors don't clash
        related_name="%(class)s_created_by",
        verbose_name="Created By",
        null=True,
    )
    updated_by = models.ForeignKey(
        "db.User",
        on_delete=models.SET_NULL,
        related_name="%(class)s_updated_by",
        verbose_name="Last Modified By",
        null=True,
    )

    class Meta:
        abstract = True


class SoftDeletionQuerySet(models.QuerySet):
    """QuerySet whose bulk ``delete()`` soft-deletes by default."""

    def delete(self, soft=True):
        """Set ``deleted_at`` on all rows (soft) or hard delete them when ``soft=False``.

        Note: unlike ``SoftDeleteModel.delete``, the bulk soft delete does not
        cascade to related objects.
        """
        if soft:
            return self.update(deleted_at=timezone.now())
        else:
            return super().delete()


class SoftDeletionManager(models.Manager):
    """Default manager that excludes soft-deleted rows (``deleted_at`` set)."""

    def get_queryset(self):
        return SoftDeletionQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    """Abstract base adding soft deletion via ``deleted_at``.

    ``objects`` hides soft-deleted rows; ``all_objects`` returns every row.
    """

    deleted_at = models.DateTimeField(verbose_name="Deleted At", null=True, blank=True)

    objects = SoftDeletionManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def delete(self, using=None, soft=True, *args, **kwargs):
        """Soft delete this instance (default) or hard delete it when ``soft=False``.

        Soft delete saves ``deleted_at`` and enqueues the
        ``soft_delete_related_objects`` Celery task to cascade to related rows.
        """
        if soft:
            # Soft delete the current instance
            self.deleted_at = timezone.now()
            self.save(using=using)

            soft_delete_related_objects.delay(self._meta.app_label, self._meta.model_name, self.pk, using=using)

        else:
            # Perform hard delete if soft deletion is not enabled
            return super().delete(using=using, *args, **kwargs)


class AuditModel(TimeAuditModel, UserAuditModel, SoftDeleteModel):
    """Abstract base combining timestamps, user audit fields and soft deletion."""

    class Meta:
        abstract = True


class ChangeTrackerMixin:
    """
    A mixin to track changes in model fields between initialization and save.

    This mixin captures the initial state of model fields when the instance is
    created and provides utilities to detect which fields have changed.

    Usage:
        To track specific fields, define a TRACKED_FIELDS list on your model:

        class MyModel(ChangeTrackerMixin, models.Model):
            TRACKED_FIELDS = ['field1', 'field2', 'field3']
            field1 = models.CharField(max_length=100)
            field2 = models.IntegerField()
            field3 = models.BooleanField()

        If TRACKED_FIELDS is not defined, all non-deferred fields will be tracked.

    Properties:
        changed_fields: A list of field names that have changed since initialization.
        old_values: A dictionary mapping field names to their original values.

    Methods:
        has_changed(field_name): Check if a specific field has changed.

    Notes:
        - Deferred fields (from .defer() or .only()) are automatically excluded
          from tracking to avoid triggering database queries.
        - Field values are captured in __init__, so changes are tracked relative
          to the initial state when the instance was loaded from the database.
    """

    _original_values: dict[str, Any]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Snapshot field values right after the instance is built/loaded
        self._original_values = {}
        self._track_fields()

    def _track_fields(self) -> None:
        """
        Capture the initial values of fields to track.

        This method stores the current values of fields that should be tracked.
        If TRACKED_FIELDS is defined on the model, only those fields are tracked.
        Otherwise, all non-deferred fields are tracked. Deferred fields are
        automatically excluded to prevent unnecessary database queries.
        """
        deferred_fields = self.get_deferred_fields()
        tracked_fields = getattr(self, "TRACKED_FIELDS", None)
        if tracked_fields:
            for field in tracked_fields:
                if field not in deferred_fields:
                    self._original_values[field] = getattr(self, field)
        else:
            for field in self._meta.fields:
                if field.attname not in deferred_fields:
                    self._original_values[field.attname] = getattr(self, field.attname)

    def has_changed(self, field_name: str) -> bool:
        """
        Check if a specific field has changed since initialization.

        Args:
            field_name (str): The name of the field to check.

        Returns:
            bool: True if the field has changed, False otherwise. Returns False
                  if the field was not being tracked or is deferred.
        """
        if field_name not in self._original_values:
            return False
        return self._original_values[field_name] != getattr(self, field_name)

    @property
    def changed_fields(self) -> list[str]:
        """
        Get a list of all fields that have changed since initialization.

        Returns:
            list[str]: A list of field names that have different values than
                       when the instance was initialized. Returns an empty list
                       if no fields have changed.
        """
        changed = []
        for field, old_val in self._original_values.items():
            new_val = getattr(self, field)
            if old_val != new_val:
                changed.append(field)
        return changed

    @property
    def old_values(self) -> dict[str, Any]:
        """
        Get a dictionary of the original field values from initialization.

        Returns:
            dict: A dictionary mapping field names to their original values
                  as they were when the instance was initialized. Only includes
                  fields that are being tracked (either via TRACKED_FIELDS or
                  all non-deferred fields).
        """
        return self._original_values

    def save(self, *args: Any, **kwargs: Any) -> None:
        """
        Override save to automatically capture changed fields and reset tracking.

        Before saving, the current changed_fields are captured and stored in
        _changes_on_save. After saving, the tracked fields are reset so
        that subsequent saves correctly detect changes relative to the last
        saved state, not the original load-time state.

        Models that need to access the changed fields after save (e.g., for
        syncing related models) can use self._changes_on_save.
        """
        self._changes_on_save = self.changed_fields
        super().save(*args, **kwargs)
        self._reset_tracked_fields()

    def _reset_tracked_fields(self) -> None:
        """
        Reset the tracked field values to the current state.

        This is called automatically after save() to ensure that subsequent
        saves correctly detect changes relative to the last saved state,
        rather than the original load-time state.
        """
        self._original_values = {}
        self._track_fields()
