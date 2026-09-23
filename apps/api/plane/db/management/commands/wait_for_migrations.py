# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``wait_for_migrations``: block until all migrations are applied.

Used by the Celery worker/beat entrypoints so background processes don't start
against an out-of-date schema while the API container is still migrating.
"""

# wait_for_migrations.py
import time
from django.core.management.base import BaseCommand
from django.db.migrations.executor import MigrationExecutor
from django.db import connections, DEFAULT_DB_ALIAS


class Command(BaseCommand):
    """Poll the migration state every 10 seconds until nothing is pending."""

    help = "Wait for database migrations to complete before starting Celery worker/beat"

    def handle(self, *args, **kwargs):
        """Loop until ``_pending_migrations`` reports no unapplied migrations."""
        while self._pending_migrations():
            self.stdout.write("Waiting for database migrations to complete...")
            time.sleep(10)  # wait for 10 seconds before checking again

        self.stdout.write(self.style.SUCCESS("No migrations Pending. Starting processes ..."))

    def _pending_migrations(self):
        """Return True if any migration up to the graph's leaf nodes is not yet applied."""
        connection = connections[DEFAULT_DB_ALIAS]
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        return bool(executor.migration_plan(targets))
