# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``wait_for_db``: block until the default database is reachable.

Used by container entrypoints before running migrations or starting the server.
"""

import time
from django.db import connections
from django.db.utils import OperationalError
from django.core.management import BaseCommand


class Command(BaseCommand):
    """Django command to pause execution until db is available"""

    def handle(self, *args, **options):
        """Retry obtaining the default DB connection every second until it succeeds."""
        self.stdout.write("Waiting for database...")
        db_conn = None
        while not db_conn:
            try:
                # Note: this returns a lazy connection wrapper and does not itself open a
                # connection, so it rarely raises OperationalError in practice
                db_conn = connections["default"]
            except OperationalError:
                self.stdout.write("Database unavailable, waititng 1 second...")
                time.sleep(1)

        self.stdout.write(self.style.SUCCESS("Database available!"))
