# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Emailed one-time codes for two-factor authentication.

The client only ever holds an opaque random token. The 6-digit code is kept in
Redis as an HMAC (keyed with ``SECRET_KEY``) bound to purpose and token, so a
Redis dump or a leaked token does not reveal it. Codes are single use and the
entry is dropped after ``MAX_VERIFY_ATTEMPTS`` wrong guesses.
"""

# Python imports
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone

# Django imports
from django.conf import settings

# Module imports
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.settings.redis import redis_instance

PURPOSE_SETUP = "2fa-setup"
PURPOSE_SIGNIN = "2fa-signin"

MAX_VERIFY_ATTEMPTS = 5
CODE_TTL_SECONDS = int(os.environ.get("TWO_FACTOR_CODE_TTL", 600))


def _key(purpose, token):
    return f"two_factor:{purpose}:{token}"


def _attempts_key(key):
    return f"{key}:attempts"


def _hash_code(purpose, token, code):
    message = f"{purpose}:{token}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()


def _error(name):
    return AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[name], error_message=name)


def _load(ri, key):
    raw = ri.get(key)
    if raw is None:
        return None
    entry = json.loads(raw)
    if entry["expires_at"] <= time.time():
        return None
    return entry


def normalize_code(code):
    """Drop the spaces and dashes people paste along with a code (the emails show it as ``482 913``)."""
    return "".join(ch for ch in str(code or "") if ch.isdigit())


def issue(purpose, data, ttl=CODE_TTL_SECONDS):
    """Store a new code for ``data`` and return ``(token, code, expires_at)``; ``expires_at`` is ISO 8601 UTC."""
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(10**6):06d}"
    expires_at = time.time() + ttl
    key = _key(purpose, token)
    entry = {"code_hash": _hash_code(purpose, token, code), "expires_at": expires_at, "data": data}
    ri = redis_instance()
    ri.set(key, json.dumps(entry), ex=ttl)
    ri.delete(_attempts_key(key))
    return token, code, datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()


def peek(purpose, token):
    """Return what a live token is bound to without counting an attempt, or None if it is unknown or expired."""
    if not token:
        return None
    entry = _load(redis_instance(), _key(purpose, token))
    return entry["data"] if entry else None


def verify(purpose, token, code):
    """Check ``code`` for ``token`` and return the bound data; the entry is consumed on success.

    Raises EXPIRED_TWO_FACTOR_CODE when the token is unknown, expired or already used,
    INVALID_TWO_FACTOR_CODE for a wrong code, and TWO_FACTOR_ATTEMPTS_EXHAUSTED (after
    deleting the entry) on the MAX_VERIFY_ATTEMPTS-th wrong code.
    """
    if not token:
        raise _error("EXPIRED_TWO_FACTOR_CODE")
    ri = redis_instance()
    key = _key(purpose, token)
    entry = _load(ri, key)
    if entry is None:
        raise _error("EXPIRED_TWO_FACTOR_CODE")

    expected = entry["code_hash"]
    actual = _hash_code(purpose, token, normalize_code(code))
    if not hmac.compare_digest(expected, actual):
        # INCR is atomic, so parallel wrong guesses can't exceed the cap; the counter
        # lives no longer than the code itself
        remaining = max(1, int(entry["expires_at"] - time.time()))
        pipe = ri.pipeline()
        pipe.incr(_attempts_key(key))
        pipe.expire(_attempts_key(key), remaining)
        attempts = int(pipe.execute()[0])
        if attempts >= MAX_VERIFY_ATTEMPTS:
            ri.delete(key, _attempts_key(key))
            raise _error("TWO_FACTOR_ATTEMPTS_EXHAUSTED")
        raise _error("INVALID_TWO_FACTOR_CODE")

    # DEL reports whether this request removed the entry, so a code can't be used twice in parallel
    if not ri.delete(key):
        raise _error("EXPIRED_TWO_FACTOR_CODE")
    ri.delete(_attempts_key(key))
    return entry["data"]


def revoke(purpose, token):
    """Invalidate a token, e.g. when it is replaced by a resend or the email could not be queued."""
    if not token:
        return
    key = _key(purpose, token)
    redis_instance().delete(key, _attempts_key(key))
