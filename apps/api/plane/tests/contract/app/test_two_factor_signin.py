# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Contract tests for password sign-in with email two-factor authentication:
the web app (``sign-in`` then ``sign-in/two-factor/``), the admin console
(``/api/instances/admins/sign-in/`` then ``.../two-factor/``) and the space app,
which refuses password sign-in for two-factor users.

Sign-in endpoints answer with 302 redirects, so assertions read the redirect URL.
The email task is patched and the code read from its arguments. Requires a live Redis.
"""

import uuid
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.core.cache import cache
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from plane.authentication.adapter.error import AUTHENTICATION_ERROR_CODES
from plane.authentication.utils import two_factor_lockout, verification_code
from plane.db.models import User
from plane.license.models import Instance, InstanceAdmin

PASSWORD = "user@123"
SEND_TASK = "plane.authentication.utils.two_factor_signin.two_factor_code_email.delay"
SMTP = "plane.authentication.utils.two_factor_signin.smtp_configured"
ADMIN_SIGN_IN = "/api/instances/admins/sign-in/"
ADMIN_TWO_FACTOR = "/api/instances/admins/sign-in/two-factor/"


def _params(response):
    return {key: values[0] for key, values in parse_qs(urlparse(response.url).query).items()}


def _error(response):
    return _params(response).get("error_message")


def _code(mock_send):
    return mock_send.call_args[0][1]


def _wrong(code):
    return "000000" if code != "000000" else "111111"


@pytest.fixture
def setup_instance(db):
    instance = Instance.objects.first()
    defaults = {
        "instance_name": "Test Instance",
        "instance_id": str(uuid.uuid4()),
        "current_version": "1.0.0",
        "domain": "http://localhost:8000",
        "last_checked_at": timezone.now(),
        "is_setup_done": True,
    }
    instance, _ = Instance.objects.update_or_create(id=instance.id if instance else uuid.uuid4(), defaults=defaults)
    return instance


@pytest.fixture
def two_factor_user(db):
    user = User.objects.create(
        email=f"2fa-{uuid.uuid4().hex[:8]}@plane.so",
        username=uuid.uuid4().hex,
        is_two_factor_email_enabled=True,
        two_factor_enabled_at=timezone.now(),
    )
    user.set_password(PASSWORD)
    user.save()
    return user


@pytest.fixture
def client():
    return Client(HTTP_USER_AGENT="Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")


@pytest.fixture(autouse=True)
def reset_throttle():
    """The code step shares the per-IP AuthenticationThrottle; clear its history around each test."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def mock_send():
    with patch(SMTP, return_value=True), patch(SEND_TASK) as mock:
        yield mock


def _sign_in(client, user, password=PASSWORD, next_path=None):
    data = {"email": user.email, "password": password}
    if next_path:
        data["next_path"] = next_path
    return client.post(reverse("sign-in"), data)


def _submit(client, code, next_path=None):
    data = {"code": code}
    if next_path:
        data["next_path"] = next_path
    return client.post(reverse("sign-in-two-factor"), data)


@pytest.mark.contract
@pytest.mark.django_db
class TestAppTwoFactorSignIn:
    def test_password_then_code_signs_in(self, client, two_factor_user, setup_instance, mock_send):
        with patch("plane.authentication.views.app.two_factor_signin.post_user_auth_workflow") as workflow:
            response = _sign_in(client, two_factor_user)
            assert _error(response) == "TWO_FACTOR_REQUIRED"
            assert _params(response)["email"] == two_factor_user.email
            assert "_auth_user_id" not in client.session
            assert mock_send.call_args[0][0] == two_factor_user.email
            assert mock_send.call_args[0][2] == "signin"

            response = _submit(client, _code(mock_send))
        assert response.status_code == 302
        assert "error_code" not in response.url
        assert client.session["_auth_user_id"] == str(two_factor_user.id)
        assert "two_factor_challenge" not in client.session
        two_factor_user.refresh_from_db()
        assert two_factor_user.last_login_medium == "email"
        workflow.assert_called_once()
        assert workflow.call_args[0][0] == two_factor_user

    def test_next_path_is_kept(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user, next_path="workspaces")
        response = _submit(client, _code(mock_send))
        assert "workspaces" in response.url

    def test_wrong_password_sends_no_code(self, client, two_factor_user, setup_instance, mock_send):
        response = _sign_in(client, two_factor_user, password="wrong-password")
        assert _error(response) == "AUTHENTICATION_FAILED_SIGN_IN"
        mock_send.assert_not_called()

    def test_wrong_code_keeps_the_challenge(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user)
        code = _code(mock_send)
        response = _submit(client, _wrong(code))
        assert _error(response) == "INVALID_TWO_FACTOR_CODE"
        assert _params(response)["email"] == two_factor_user.email
        assert "_auth_user_id" not in client.session
        response = _submit(client, code)
        assert client.session["_auth_user_id"] == str(two_factor_user.id)

    def test_attempts_exhausted(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user)
        code = _code(mock_send)
        for _ in range(verification_code.MAX_VERIFY_ATTEMPTS - 1):
            _submit(client, _wrong(code))
        assert _error(_submit(client, _wrong(code))) == "TWO_FACTOR_ATTEMPTS_EXHAUSTED"
        assert _error(_submit(client, code)) == "EXPIRED_TWO_FACTOR_CODE"
        assert "_auth_user_id" not in client.session

    def test_challenge_is_bound_to_the_session(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user)
        other_browser = Client()
        response = other_browser.post(reverse("sign-in-two-factor"), {"code": _code(mock_send)})
        assert _error(response) == "EXPIRED_TWO_FACTOR_CODE"
        assert "_auth_user_id" not in other_browser.session

    def test_locked_user(self, client, two_factor_user, setup_instance, mock_send):
        user_id = str(two_factor_user.id)
        for _ in range(two_factor_lockout.MAX_FAILURES - 1):
            two_factor_lockout.record_failure(user_id)
        _sign_in(client, two_factor_user)
        code = _code(mock_send)
        assert _error(_submit(client, _wrong(code))) == "TWO_FACTOR_LOCKED"
        # the right code doesn't help while locked
        _sign_in(client, two_factor_user)
        assert _error(_submit(client, _code(mock_send))) == "TWO_FACTOR_LOCKED"
        assert "_auth_user_id" not in client.session

    def test_smtp_not_configured(self, client, two_factor_user, setup_instance):
        with patch(SMTP, return_value=False), patch(SEND_TASK) as mock_send:
            response = _sign_in(client, two_factor_user)
        assert _error(response) == "SMTP_NOT_CONFIGURED"
        mock_send.assert_not_called()
        assert "_auth_user_id" not in client.session

    def test_resend(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user)
        first_code = _code(mock_send)
        url = reverse("sign-in-two-factor-resend")

        # too soon
        response = client.post(url, content_type="application/json")
        assert response.status_code == 400
        assert response.json()["error_message"] == "RATE_LIMIT_EXCEEDED"

        with patch("plane.authentication.utils.two_factor_signin.RESEND_COOLDOWN_SECONDS", 0):
            response = client.post(url, content_type="application/json")
            assert response.status_code == 200
            second_code = _code(mock_send)
            # the old code went with the old challenge
            if first_code != second_code:
                assert _error(_submit(client, first_code)) == "INVALID_TWO_FACTOR_CODE"
            response = _submit(client, second_code)
        assert client.session["_auth_user_id"] == str(two_factor_user.id)

    def test_resend_limit(self, client, two_factor_user, setup_instance, mock_send):
        _sign_in(client, two_factor_user)
        url = reverse("sign-in-two-factor-resend")
        with patch("plane.authentication.utils.two_factor_signin.RESEND_COOLDOWN_SECONDS", 0):
            for _ in range(3):
                assert client.post(url, content_type="application/json").status_code == 200
            response = client.post(url, content_type="application/json")
        assert response.json()["error_message"] == "RATE_LIMIT_EXCEEDED"

    def test_resend_without_challenge(self, client, setup_instance):
        response = client.post(reverse("sign-in-two-factor-resend"), content_type="application/json")
        assert response.json()["error_message"] == "EXPIRED_TWO_FACTOR_CODE"

    def test_user_without_two_factor_is_unaffected(self, client, two_factor_user, setup_instance, mock_send):
        two_factor_user.is_two_factor_email_enabled = False
        two_factor_user.save()
        response = _sign_in(client, two_factor_user)
        assert "error_code" not in response.url
        assert client.session["_auth_user_id"] == str(two_factor_user.id)
        mock_send.assert_not_called()


@pytest.mark.contract
@pytest.mark.django_db
class TestSpaceTwoFactorSignIn:
    def test_refused_after_correct_password(self, client, two_factor_user, setup_instance, mock_send):
        response = client.post(reverse("space-sign-in"), {"email": two_factor_user.email, "password": PASSWORD})
        assert _error(response) == "TWO_FACTOR_SPACE_UNSUPPORTED"
        assert "_auth_user_id" not in client.session
        mock_send.assert_not_called()

    def test_wrong_password_gives_the_usual_error(self, client, two_factor_user, setup_instance, mock_send):
        response = client.post(reverse("space-sign-in"), {"email": two_factor_user.email, "password": "wrong"})
        assert _error(response) == "AUTHENTICATION_FAILED_SIGN_IN"


@pytest.mark.contract
@pytest.mark.django_db
class TestAdminTwoFactorSignIn:
    @pytest.fixture
    def admin(self, two_factor_user, setup_instance):
        InstanceAdmin.objects.create(user=two_factor_user, instance=setup_instance, role=20)
        return two_factor_user

    def test_password_then_code_starts_admin_session(self, client, admin, mock_send):
        response = client.post(ADMIN_SIGN_IN, {"email": admin.email, "password": PASSWORD})
        assert _error(response) == "TWO_FACTOR_REQUIRED"
        assert mock_send.call_args[0][2] == "admin_signin"
        assert "admin-session-id" in client.cookies

        response = client.post(ADMIN_TWO_FACTOR, {"code": _code(mock_send)})
        assert response.status_code == 302
        assert response.url.endswith("general/")
        assert "error_code" not in response.url

    def test_app_challenge_is_refused_at_admin_endpoint(self, client, admin, mock_send):
        _sign_in(client, admin)
        response = client.post(ADMIN_TWO_FACTOR, {"code": _code(mock_send)})
        assert _error(response) == "EXPIRED_TWO_FACTOR_CODE"

    def test_admin_rights_rechecked_after_code(self, client, admin, mock_send):
        client.post(ADMIN_SIGN_IN, {"email": admin.email, "password": PASSWORD})
        InstanceAdmin.objects.filter(user=admin).delete()
        response = client.post(ADMIN_TWO_FACTOR, {"code": _code(mock_send)})
        assert _error(response) == "ADMIN_AUTHENTICATION_FAILED"

    def test_wrong_password_sends_no_code(self, client, admin, mock_send):
        response = client.post(ADMIN_SIGN_IN, {"email": admin.email, "password": "wrong"})
        assert _error(response) == "ADMIN_AUTHENTICATION_FAILED"
        mock_send.assert_not_called()


def test_error_codes_are_unique():
    codes = list(AUTHENTICATION_ERROR_CODES.values())
    assert len(codes) == len(set(codes))
