# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""UUID helpers: v4 validation and deterministic UUID -> 64-bit integer conversion."""

# Python imports
import uuid
import hashlib


def is_valid_uuid(uuid_str):
    """Check if a string is a valid UUID version 4"""
    try:
        uuid_obj = uuid.UUID(uuid_str)
        return uuid_obj.version == 4
    except ValueError:
        return False


def convert_uuid_to_integer(uuid_val: uuid.UUID) -> int:
    """Convert a UUID to a 64-bit signed integer

    The mapping is deterministic (same UUID -> same int) but not reversible; it
    takes the first 8 bytes of the SHA-256 digest, so collisions are possible
    but unlikely. Useful where a signed bigint key is required (e.g. Postgres
    advisory locks).
    """
    # Ensure UUID is a string
    uuid_value: str = str(uuid_val)
    # Hash to 64-bit signed int
    h: bytes = hashlib.sha256(uuid_value.encode()).digest()
    bigint: int = int.from_bytes(h[:8], byteorder="big", signed=True)
    return bigint
