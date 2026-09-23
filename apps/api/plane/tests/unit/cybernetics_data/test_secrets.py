# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.utils.cybernetics_data.secrets``: API token encryption, masked hints and fingerprints."""

from unittest.mock import patch

import pytest

from plane.utils.cybernetics_data.secrets import (
    TokenDecryptionError,
    decrypt_token,
    encrypt_token,
    token_fingerprint,
    token_hint,
)

TOKEN = "cybernetics_abc_def_1a2b"


@pytest.mark.unit
class TestEncryption:
    """Encrypt/decrypt round trips and failure modes of the stored API token."""

    def test_round_trip(self):
        encrypted = encrypt_token(TOKEN)
        assert encrypted and encrypted != TOKEN
        assert TOKEN not in encrypted
        assert decrypt_token(encrypted) == TOKEN

    def test_encrypt_empty(self):
        assert encrypt_token("") == ""

    def test_encrypt_failure_raises(self):
        """An empty result from the underlying cipher is treated as an error, not stored."""
        with patch("plane.utils.cybernetics_data.secrets.encrypt_data", return_value=""):
            with pytest.raises(ValueError):
                encrypt_token(TOKEN)

    def test_decrypt_empty(self):
        assert decrypt_token("") == ""

    @pytest.mark.parametrize("garbage", ["not-a-fernet-token", "gAAAAAB" + "A" * 80])
    def test_decrypt_garbage(self, garbage):
        """Non-Fernet and forged Fernet-looking values raise ``TokenDecryptionError``."""
        with pytest.raises(TokenDecryptionError):
            decrypt_token(garbage)

    def test_rotated_secret_key(self, settings):
        """Tokens encrypted under an old ``SECRET_KEY`` become unreadable after rotation."""
        encrypted = encrypt_token(TOKEN)
        settings.SECRET_KEY = "a-completely-different-secret-key-for-this-test"
        with pytest.raises(TokenDecryptionError):
            decrypt_token(encrypted)


@pytest.mark.unit
class TestHintAndFingerprint:
    """Display hints and fingerprints must never reveal the full token."""

    def test_hint_boundaries(self):
        """Tokens of 8 chars or fewer are fully masked; longer ones show first/last 4 chars."""
        assert token_hint("12345678") == "••••"
        assert token_hint("123456789") == "1234…6789"
        assert token_hint("") == "••••"

    def test_hint_never_contains_whole_token(self):
        assert token_hint(TOKEN) == "cybe…1a2b"
        assert TOKEN not in token_hint(TOKEN)

    def test_fingerprint(self):
        """Fingerprint is a deterministic 64-hex-char digest (SHA-256 length) that changes with the token."""
        assert token_fingerprint(TOKEN) == token_fingerprint(TOKEN)
        assert len(token_fingerprint(TOKEN)) == 64
        assert token_fingerprint(TOKEN) != token_fingerprint(TOKEN + "x")
        assert TOKEN not in token_fingerprint(TOKEN)
