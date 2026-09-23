# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``clear_cache``: flush the Django cache (e.g. Redis).

Run before server start to drop stale cached values. Pass ``--key`` to delete
a single cache key instead of clearing everything.
"""

# Django imports
from django.core.cache import cache
from django.core.management import BaseCommand


class Command(BaseCommand):
    """Clear the whole cache, or a single key when ``--key`` is given."""

    help = "Clear Cache before starting the server to remove stale values"

    def add_arguments(self, parser):
        # Positional argument
        parser.add_argument("--key", type=str, nargs="?", help="Key to clear cache")

    def handle(self, *args, **options):
        """Delete ``--key`` if provided, otherwise ``cache.clear()``; errors are reported, not raised."""
        try:
            if options["key"]:
                cache.delete(options["key"])
                self.stdout.write(self.style.SUCCESS(f"Cache Cleared for key: {options['key']}"))
                return

            cache.clear()
            self.stdout.write(self.style.SUCCESS("Cache Cleared"))
            return
        except Exception:
            # Another ClientError occurred
            self.stdout.write(self.style.ERROR("Failed to clear cache"))
            return
