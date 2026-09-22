# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from channels.db import database_sync_to_async


def db_call(fn):
    """
    Run a blocking ORM function from async MCP code.

    Uses a pooled thread (not the process-wide thread-sensitive one) and closes
    stale DB connections before and after the call, like a Django request would.
    """
    return database_sync_to_async(fn, thread_sensitive=False)
