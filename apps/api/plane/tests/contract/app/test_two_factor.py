# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Contract tests for turning email two-factor authentication on and off
(``/auth/two-factor/email/send-code/``, ``.../enable/``, ``.../disable/``).

Emails are not sent: the Celery ``delay`` calls are patched and the code is read
from the call arguments. Requires a live Redis for the code store.
"""

from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework import status

from plane.authentication.adapter.error import AUTHENTICATION_ERROR_CODES
from plane.db.models import User

SEND_CODE_TASK = "plane.authentication.views.app.two_factor.two_factor_code_email.delay"
CHANGED_TASK = "plane.authentication.views.app.two_factor.two_factor_changed_email.delay"
SMTP = "plane.authentication.views.app.two_factor.smtp_configured"


def _code_from(mock_send):
    """The code is the second positional argument of two_factor_code_email.delay."""
    return mock_send.call_args[0][1]


def _send_code(client, action, password):
    return client.post(reverse("two-factor-email-send-code"), {"action": action, "password": password}, format="json")


def _confirm(client, action, token, code):
    return client.post(reverse(f"two-factor-email-{action}"), {"token": token, "code": code}, format="json")


@pytest.fixture
def smtp_on():
    with patch(SMTP, return_value=True):
        yield


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.usefixtures("smtp_on")
class TestTwoFactorEmailSettings:
    @patch(CHANGED_TASK)
    @patch(SEND_CODE_TASK)
    def test_enable_then_disable(self, mock_send, mock_changed, session_client, create_user, user_data):
        response = _send_code(session_client, "enable", user_data["password"])
        assert response.status_code == status.HTTP_200_OK
        assert set(response.data) == {"token", "expires_at"}
        args = mock_send.call_args[0]
        assert args[0] == create_user.email and args[2] == "enable"
        assert set(args[3]) == {"time", "ip", "device"}

        response = _confirm(session_client, "enable", response.data["token"], _code_from(mock_send))
        assert response.status_code == status.HTTP_200_OK
        create_user.refresh_from_db()
        assert create_user.is_two_factor_email_enabled is True
        assert create_user.two_factor_enabled_at is not None
        assert mock_changed.call_args[0][:2] == (create_user.email, True)

        response = _send_code(session_client, "disable", user_data["password"])
        assert response.status_code == status.HTTP_200_OK
        response = _confirm(session_client, "disable", response.data["token"], _code_from(mock_send))
        assert response.status_code == status.HTTP_200_OK
        create_user.refresh_from_db()
        assert create_user.is_two_factor_email_enabled is False
        assert create_user.two_factor_enabled_at is None
        assert mock_changed.call_args[0][:2] == (create_user.email, False)

    @patch(SEND_CODE_TASK)
    def test_code_can_be_used_once(self, mock_send, session_client, user_data):
        token = _send_code(session_client, "enable", user_data["password"]).data["token"]
        code = _code_from(mock_send)
        assert _confirm(session_client, "enable", token, code).status_code == status.HTTP_200_OK
        response = _confirm(session_client, "enable", token, code)
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["EXPIRED_TWO_FACTOR_CODE"]

    @patch(SEND_CODE_TASK)
    def test_wrong_password(self, mock_send, session_client):
        response = _send_code(session_client, "enable", "not-the-password")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["INCORRECT_OLD_PASSWORD"]
        mock_send.assert_not_called()

    @patch(SEND_CODE_TASK)
    def test_password_required(self, mock_send, session_client, create_user, user_data):
        create_user.is_password_autoset = True
        create_user.save()
        response = _send_code(session_client, "enable", user_data["password"])
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["TWO_FACTOR_PASSWORD_REQUIRED"]
        mock_send.assert_not_called()

    @patch(SEND_CODE_TASK)
    def test_smtp_not_configured(self, mock_send, session_client, user_data):
        with patch(SMTP, return_value=False):
            response = _send_code(session_client, "enable", user_data["password"])
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["SMTP_NOT_CONFIGURED"]
        mock_send.assert_not_called()

    @patch(SEND_CODE_TASK)
    def test_action_must_match_state(self, mock_send, session_client, create_user, user_data):
        response = _send_code(session_client, "disable", user_data["password"])
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["TWO_FACTOR_NOT_ENABLED"]
        create_user.is_two_factor_email_enabled = True
        create_user.save()
        response = _send_code(session_client, "enable", user_data["password"])
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["TWO_FACTOR_ALREADY_ENABLED"]
        mock_send.assert_not_called()

    def test_unknown_action(self, session_client, user_data):
        response = _send_code(session_client, "toggle", user_data["password"])
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch(SEND_CODE_TASK)
    def test_wrong_code(self, mock_send, session_client, create_user, user_data):
        token = _send_code(session_client, "enable", user_data["password"]).data["token"]
        wrong = "000000" if _code_from(mock_send) != "000000" else "111111"
        response = _confirm(session_client, "enable", token, wrong)
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["INVALID_TWO_FACTOR_CODE"]
        create_user.refresh_from_db()
        assert create_user.is_two_factor_email_enabled is False

    @patch(SEND_CODE_TASK)
    def test_code_is_bound_to_action(self, mock_send, session_client, create_user, user_data):
        create_user.is_two_factor_email_enabled = True
        create_user.save()
        token = _send_code(session_client, "disable", user_data["password"]).data["token"]
        # a disable code sent to the enable endpoint is rejected
        response = _confirm(session_client, "enable", token, _code_from(mock_send))
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["INVALID_TWO_FACTOR_CODE"]

    @patch(SEND_CODE_TASK)
    def test_code_is_bound_to_user(self, mock_send, api_client, session_client, user_data):
        token = _send_code(session_client, "enable", user_data["password"]).data["token"]
        code = _code_from(mock_send)
        other = User.objects.create(email="other@plane.so", username="other-user")
        api_client.force_authenticate(user=other)
        response = _confirm(api_client, "enable", token, code)
        assert response.data["error_code"] == AUTHENTICATION_ERROR_CODES["INVALID_TWO_FACTOR_CODE"]
        other.refresh_from_db()
        assert other.is_two_factor_email_enabled is False

    def test_requires_sign_in(self, api_client):
        response = _send_code(api_client, "enable", "x")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_profile_update_cannot_change_two_factor(self, session_client, create_user):
        response = session_client.patch(
            "/api/users/me/", {"is_two_factor_email_enabled": True, "first_name": "Changed"}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        create_user.refresh_from_db()
        assert create_user.first_name == "Changed"
        assert create_user.is_two_factor_email_enabled is False
