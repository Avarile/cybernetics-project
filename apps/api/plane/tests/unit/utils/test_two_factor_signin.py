# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the two-factor sign-in challenge (plane.authentication.utils.two_factor_signin).

The session is a dict, Redis an in-memory fake and the user lookup a stub, so these run
without a database; the HTTP flows are covered by the contract tests in
tests/contract/app/test_two_factor_signin.py.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from freezegun import freeze_time

from plane.authentication.adapter.error import AuthenticationException
from plane.authentication.utils import two_factor_lockout, two_factor_signin, verification_code
from plane.authentication.utils.two_factor_signin import SESSION_KEY

from .fake_redis import FakeRedis

MODULE = "plane.authentication.utils.two_factor_signin"


@pytest.fixture
def user():
    return SimpleNamespace(id=uuid.uuid4(), email="avarile@gmail.com", user_timezone="UTC")


@pytest.fixture
def send(mocker, user):
    redis = FakeRedis()
    mocker.patch("plane.authentication.utils.verification_code.redis_instance", return_value=redis)
    mocker.patch("plane.authentication.utils.two_factor_lockout.redis_instance", return_value=redis)
    mocker.patch(f"{MODULE}.smtp_configured", return_value=True)
    mocker.patch(f"{MODULE}.get_request_meta", return_value={})
    mocker.patch(f"{MODULE}.base_host", return_value="http://localhost")
    users = MagicMock()
    users.objects.filter.return_value.first.return_value = user
    mocker.patch(f"{MODULE}.User", users)
    return mocker.patch(f"{MODULE}.two_factor_code_email.delay")


def _request():
    return SimpleNamespace(session={}, META={})


def _code(send):
    return send.call_args[0][1]


def _name(exc_info):
    return exc_info.value.error_message


@pytest.mark.unit
class TestTwoFactorSignInChallenge:
    def test_start_then_complete(self, send, user):
        request = _request()
        exc = two_factor_signin.start_challenge(request, user, "app", next_path="workspaces")
        assert exc.error_message == "TWO_FACTOR_REQUIRED"
        assert exc.payload == {"email": user.email}
        assert send.call_args[0][2] == "signin"
        assert SESSION_KEY in request.session

        signed_in, data = two_factor_signin.complete_challenge(request, "app", _code(send))
        assert signed_in is user
        assert data["next_path"] == "workspaces"
        assert SESSION_KEY not in request.session

    def test_admin_audience_uses_admin_email(self, send, user):
        two_factor_signin.start_challenge(_request(), user, "admin")
        assert send.call_args[0][2] == "admin_signin"

    def test_audience_must_match(self, send, user):
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(request, "admin", _code(send))
        assert _name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_no_challenge_in_session(self, send):
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(_request(), "app", "123456")
        assert _name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"

    def test_wrong_code_keeps_challenge_and_carries_email(self, send, user):
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        code = _code(send)
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(request, "app", "000000" if code != "000000" else "111111")
        assert _name(exc_info) == "INVALID_TWO_FACTOR_CODE"
        assert exc_info.value.payload["email"] == user.email
        assert SESSION_KEY in request.session
        assert two_factor_signin.complete_challenge(request, "app", code)[0] is user

    def test_exhausted_challenge_is_dropped(self, send, user):
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        wrong = "000000" if _code(send) != "000000" else "111111"
        for _ in range(verification_code.MAX_VERIFY_ATTEMPTS - 1):
            with pytest.raises(AuthenticationException):
                two_factor_signin.complete_challenge(request, "app", wrong)
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(request, "app", wrong)
        assert _name(exc_info) == "TWO_FACTOR_ATTEMPTS_EXHAUSTED"
        assert SESSION_KEY not in request.session

    def test_wrong_codes_lock_the_user(self, send, user):
        for _ in range(two_factor_lockout.MAX_FAILURES - 1):
            two_factor_lockout.record_failure(str(user.id))
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        code = _code(send)
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(request, "app", "000000" if code != "000000" else "111111")
        assert _name(exc_info) == "TWO_FACTOR_LOCKED"
        assert SESSION_KEY not in request.session

        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.complete_challenge(request, "app", _code(send))
        assert _name(exc_info) == "TWO_FACTOR_LOCKED"

    def test_success_clears_failures(self, send, user):
        for _ in range(two_factor_lockout.MAX_FAILURES - 1):
            two_factor_lockout.record_failure(str(user.id))
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        two_factor_signin.complete_challenge(request, "app", _code(send))
        # a fresh budget: one more failure doesn't lock
        two_factor_lockout.record_failure(str(user.id))
        two_factor_lockout.assert_not_locked(str(user.id))

    def test_signing_in_again_replaces_the_challenge(self, send, user):
        request = _request()
        two_factor_signin.start_challenge(request, user, "app")
        first_token = request.session[SESSION_KEY]
        two_factor_signin.start_challenge(request, user, "app")
        assert verification_code.peek(verification_code.PURPOSE_SIGNIN, first_token) is None

    def test_smtp_not_configured(self, send, user, mocker):
        mocker.patch(f"{MODULE}.smtp_configured", return_value=False)
        request = _request()
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.start_challenge(request, user, "app")
        assert _name(exc_info) == "SMTP_NOT_CONFIGURED"
        send.assert_not_called()
        assert SESSION_KEY not in request.session


@pytest.mark.unit
class TestTwoFactorSignInResend:
    def test_cooldown_then_resend(self, send, user):
        with freeze_time("2026-10-20 10:00:00") as frozen:
            request = _request()
            two_factor_signin.start_challenge(request, user, "app")
            first_token, first_code = request.session[SESSION_KEY], _code(send)

            with pytest.raises(AuthenticationException) as exc_info:
                two_factor_signin.resend_challenge(request, "app")
            assert _name(exc_info) == "RATE_LIMIT_EXCEEDED"
            assert exc_info.value.payload["seconds"] == two_factor_signin.RESEND_COOLDOWN_SECONDS

            frozen.tick(two_factor_signin.RESEND_COOLDOWN_SECONDS)
            two_factor_signin.resend_challenge(request, "app")
            assert request.session[SESSION_KEY] != first_token
            assert verification_code.peek(verification_code.PURPOSE_SIGNIN, first_token) is None
            assert send.call_count == 2
            if _code(send) != first_code:
                with pytest.raises(AuthenticationException):
                    two_factor_signin.complete_challenge(request, "app", first_code)
            assert two_factor_signin.complete_challenge(request, "app", _code(send))[0] is user

    def test_resend_limit(self, send, user):
        with freeze_time("2026-10-20 10:00:00") as frozen:
            request = _request()
            two_factor_signin.start_challenge(request, user, "app")
            for _ in range(two_factor_signin.MAX_RESENDS):
                frozen.tick(two_factor_signin.RESEND_COOLDOWN_SECONDS)
                two_factor_signin.resend_challenge(request, "app")
            frozen.tick(two_factor_signin.RESEND_COOLDOWN_SECONDS)
            with pytest.raises(AuthenticationException) as exc_info:
                two_factor_signin.resend_challenge(request, "app")
            assert _name(exc_info) == "RATE_LIMIT_EXCEEDED"

    def test_resend_without_challenge(self, send):
        with pytest.raises(AuthenticationException) as exc_info:
            two_factor_signin.resend_challenge(_request(), "app")
        assert _name(exc_info) == "EXPIRED_TWO_FACTOR_CODE"
