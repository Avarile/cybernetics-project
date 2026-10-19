# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Per-user lockout for two-factor sign-in codes.

Each challenge already allows only a few guesses, but someone who knows the
password can keep starting new challenges. Counting wrong codes per user across
challenges caps that: MAX_FAILURES within WINDOW_SECONDS locks two-factor sign-in
for LOCK_SECONDS.
"""

# Module imports
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.settings.redis import redis_instance

MAX_FAILURES = 10
WINDOW_SECONDS = 30 * 60
LOCK_SECONDS = 15 * 60


def _failures_key(user_id):
    return f"two_factor:failures:{user_id}"


def _lock_key(user_id):
    return f"two_factor:locked:{user_id}"


def _locked_error():
    return AuthenticationException(
        error_code=AUTHENTICATION_ERROR_CODES["TWO_FACTOR_LOCKED"],
        error_message="TWO_FACTOR_LOCKED",
        payload={"minutes": LOCK_SECONDS // 60},
    )


def assert_not_locked(user_id):
    """Raise TWO_FACTOR_LOCKED while the user is locked out."""
    if redis_instance().exists(_lock_key(user_id)):
        raise _locked_error()


def record_failure(user_id):
    """Count a wrong code; lock the user (and raise TWO_FACTOR_LOCKED) once MAX_FAILURES is reached."""
    ri = redis_instance()
    key = _failures_key(user_id)
    failures = ri.incr(key)
    if failures == 1:
        # the window starts at the first failure and isn't extended by later ones
        ri.expire(key, WINDOW_SECONDS)
    if failures >= MAX_FAILURES:
        ri.set(_lock_key(user_id), 1, ex=LOCK_SECONDS)
        ri.delete(key)
        raise _locked_error()


def clear_failures(user_id):
    """Reset the counter after a successful sign-in."""
    redis_instance().delete(_failures_key(user_id))
