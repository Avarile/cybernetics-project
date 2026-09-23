# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Encryption and display helpers for Cybernetics-Data API tokens stored in the DB.

Tokens are encrypted with ``plane.license.utils.encryption`` (keyed off SECRET_KEY).
"""

# Python imports
import hashlib

# Module imports
from plane.license.utils.encryption import decrypt_data, encrypt_data


class TokenDecryptionError(Exception):
    """The stored token can't be decrypted (typically SECRET_KEY was rotated)."""


def encrypt_token(token: str) -> str:
    """Encrypt a raw token for storage; raises ValueError if a non-empty token fails to encrypt."""
    encrypted = encrypt_data(token)
    if token and not encrypted:
        raise ValueError("Failed to encrypt Cybernetics-Data token")
    return encrypted


def decrypt_token(encrypted: str) -> str:
    """Decrypt a stored token; raises TokenDecryptionError if a non-empty value can't be decrypted."""
    value = decrypt_data(encrypted)
    # decrypt_data returns an empty value on failure instead of raising
    if encrypted and not value:
        raise TokenDecryptionError()
    return value


def token_hint(token: str) -> str:
    """Return a masked form of the token (first/last 4 chars) safe to show in the UI."""
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}…{token[-4:]}"


def token_fingerprint(token: str) -> str:
    """Return a SHA-256 hex digest of the token, stored on the integration so it can be identified without decrypting."""
    return hashlib.sha256(token.encode()).hexdigest()
