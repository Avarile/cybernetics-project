# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Symmetric encryption for secret InstanceConfiguration values.

Uses Fernet with a key derived from Django's ``SECRET_KEY``, so changing ``SECRET_KEY``
makes previously stored secrets undecryptable (they decrypt to "").
"""

import base64
import hashlib
from django.conf import settings
from cryptography.fernet import Fernet

from plane.utils.exception_logger import log_exception


def derive_key(secret_key):
    """Derive a urlsafe-base64 32-byte Fernet key from ``secret_key`` via PBKDF2-HMAC-SHA256.

    The salt is a fixed constant so the same key is derived on every process/restart.
    """
    # Use a key derivation function to get a suitable encryption key
    dk = hashlib.pbkdf2_hmac("sha256", secret_key.encode(), b"salt", 100000)
    return base64.urlsafe_b64encode(dk)


# Encrypt data
def encrypt_data(data):
    """Encrypt a string and return the token as str; returns "" for empty input or on error (logged)."""
    try:
        if data:
            cipher_suite = Fernet(derive_key(settings.SECRET_KEY))
            encrypted_data = cipher_suite.encrypt(data.encode())
            return encrypted_data.decode()  # Convert bytes to string
        else:
            return ""
    except Exception as e:
        log_exception(e)
        return ""


# Decrypt data
def decrypt_data(encrypted_data):
    """Decrypt a Fernet token string; returns "" for empty input or on error (logged)."""
    try:
        if encrypted_data:
            cipher_suite = Fernet(derive_key(settings.SECRET_KEY))
            decrypted_data = cipher_suite.decrypt(encrypted_data.encode())  # Convert string back to bytes
            return decrypted_data.decode()
        else:
            return ""
    except Exception as e:
        log_exception(e)
        return ""
