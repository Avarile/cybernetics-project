# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import hashlib

# Module imports
from plane.license.utils.encryption import decrypt_data, encrypt_data


class TokenDecryptionError(Exception):
    """The stored token can't be decrypted (typically SECRET_KEY was rotated)."""


def encrypt_token(token: str) -> str:
    encrypted = encrypt_data(token)
    if token and not encrypted:
        raise ValueError("Failed to encrypt Cybernetics-Data token")
    return encrypted


def decrypt_token(encrypted: str) -> str:
    value = decrypt_data(encrypted)
    if encrypted and not value:
        raise TokenDecryptionError()
    return value


def token_hint(token: str) -> str:
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}…{token[-4:]}"


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
