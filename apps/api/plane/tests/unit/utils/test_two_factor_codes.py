# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the two-factor code store (verification_code) and per-user lockout (two_factor_lockout).

Redis is replaced by an in-memory fake, so these run without a database or a Redis server.
"""

import json

import pytest
from freezegun import freeze_time

from plane.authentication.adapter.error import AUTHENTICATION_ERROR_CODES, AuthenticationException
from plane.authentication.utils import two_factor_lockout, verification_code
from plane.authentication.utils.verification_code import PURPOSE_SETUP, PURPOSE_SIGNIN

from .fake_redis import FakeRedis


@pytest.fixture
def fake_redis(mocker):
    redis = FakeRedis()
    mocker.patch("plane.authentication.utils.verification_code.redis_instance", return_value=redis)
    mocker.patch("plane.authentication.utils.two_factor_lockout.redis_instance", return_value=redis)
    return redis


def _error_name(exc_info):
    return exc_info.value.error_message


@pytest.mark.unit
class TestVerificationCode:
    def test_issue_returns_opaque_token_and_six_digit_code(self, fake_redis):
        token, code, expires_at = verification_code.issue(PURPOSE_SETUP, {"user_id": "u1"})
        assert len(code) == 6 and code.isdigit()
        assert code not in token
        assert expires_at.endswith("+00:00")
        # the code itself is never stored
        stored = fake_redis.store[f"two_factor:{PURPOSE_SETUP}:{token}"]
        assert code not in stored
        assert json.loads(stored)["data"] == {"user_id": "u1"}

    def test_verify_returns_data_once(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"})
        assert verification_code.verify(PURPOSE_SIGNIN, token, code) == {"user_id": "u1"}
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token, code)
        assert _error_name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_verify_accepts_spaced_code(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"})
        assert verification_code.verify(PURPOSE_SIGNIN, token, f" {code[:3]} {code[3:]} ") == {"user_id": "u1"}

    def test_wrong_code_is_invalid_then_exhausted(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"})
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(verification_code.MAX_VERIFY_ATTEMPTS - 1):
            with pytest.raises(AuthenticationException) as exc_info:
                verification_code.verify(PURPOSE_SIGNIN, token, wrong)
            assert _error_name(exc_info) == "INVALID_TWO_FACTOR_CODE"
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token, wrong)
        assert _error_name(exc_info) == "TWO_FACTOR_ATTEMPTS_EXHAUSTED"
        # the right code no longer works either
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token, code)
        assert _error_name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_code_is_bound_to_purpose(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SETUP, {"user_id": "u1"})
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token, code)
        assert _error_name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_code_is_bound_to_token(self, fake_redis):
        token_a, code_a, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "a"})
        token_b, code_b, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "b"})
        if code_a == code_b:
            pytest.skip("both codes collided")
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token_b, code_a)
        assert _error_name(exc_info) == "INVALID_TWO_FACTOR_CODE"

    def test_expired_code_is_rejected(self, fake_redis):
        with freeze_time("2026-10-20 10:00:00") as frozen:
            token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"}, ttl=600)
            frozen.tick(601)
            assert verification_code.peek(PURPOSE_SIGNIN, token) is None
            with pytest.raises(AuthenticationException) as exc_info:
                verification_code.verify(PURPOSE_SIGNIN, token, code)
        assert _error_name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    @pytest.mark.parametrize("token", ["", None, "unknown"])
    def test_missing_or_unknown_token_is_expired(self, fake_redis, token):
        with pytest.raises(AuthenticationException) as exc_info:
            verification_code.verify(PURPOSE_SIGNIN, token, "123456")
        assert _error_name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_peek_does_not_count_an_attempt(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"})
        for _ in range(verification_code.MAX_VERIFY_ATTEMPTS + 1):
            assert verification_code.peek(PURPOSE_SIGNIN, token) == {"user_id": "u1"}
        assert verification_code.verify(PURPOSE_SIGNIN, token, code) == {"user_id": "u1"}

    def test_revoke(self, fake_redis):
        token, code, _ = verification_code.issue(PURPOSE_SIGNIN, {"user_id": "u1"})
        verification_code.revoke(PURPOSE_SIGNIN, token)
        assert verification_code.peek(PURPOSE_SIGNIN, token) is None


@pytest.mark.unit
class TestTwoFactorLockout:
    def test_locks_after_max_failures(self, fake_redis):
        for _ in range(two_factor_lockout.MAX_FAILURES - 1):
            two_factor_lockout.record_failure("u1")
        two_factor_lockout.assert_not_locked("u1")
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_lockout.record_failure("u1")
        assert exc_info.value.error_code == AUTHENTICATION_ERROR_CODES["TWO_FACTOR_LOCKED"]
        with pytest.raises(AuthenticationException):
            two_factor_lockout.assert_not_locked("u1")
        # other users are unaffected
        two_factor_lockout.assert_not_locked("u2")

    def test_window_starts_at_first_failure(self, fake_redis):
        two_factor_lockout.record_failure("u1")
        two_factor_lockout.record_failure("u1")
        assert fake_redis.ttls["two_factor:failures:u1"] == two_factor_lockout.WINDOW_SECONDS

    def test_clear_failures_resets_the_count(self, fake_redis):
        for _ in range(two_factor_lockout.MAX_FAILURES - 1):
            two_factor_lockout.record_failure("u1")
        two_factor_lockout.clear_failures("u1")
        two_factor_lockout.record_failure("u1")
        two_factor_lockout.assert_not_locked("u1")
