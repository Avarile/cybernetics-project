# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import ProjectCyberneticsDataIntegration
from plane.tests.contract.app.conftest_cybernetics import (
    ADMIN,
    BASE_URL,
    GUEST,
    MEMBER,
    TOKEN,
    assert_error,
    config_url,
)
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data.client import (
    CyberneticsForbidden,
    CyberneticsNotFound,
    CyberneticsUnauthorized,
    CyberneticsUnreachable,
)
from plane.utils.cybernetics_data.secrets import decrypt_token, token_fingerprint, token_hint

pytest_plugins = ["plane.tests.contract.app.conftest_cybernetics"]
pytestmark = [pytest.mark.contract, pytest.mark.django_db]

NEW_TOKEN = "cybernetics_new456_bmV3c2lnbmF0dXJlMDAx"
OTHER_URL = "https://other.example.com"
READ_FIELDS = {
    "id",
    "project",
    "is_configured",
    "is_enabled",
    "base_url",
    "token_hint",
    "last_verified_at",
    "last_verified_status",
    "last_verified_message",
    "updated_at",
    "updated_by",
}


@pytest.fixture(autouse=True)
def _isolate(isolate):
    return isolate


@pytest.fixture
def verified_integration(integration):
    integration.last_verified_at = timezone.now() - timedelta(days=1)
    integration.last_verified_status = "ok"
    integration.last_verified_message = "previous"
    integration.save()
    return integration


def _put(client, workspace, project, payload):
    return client.put(config_url(workspace, project), payload, format="json")


def _test(client, workspace, project, payload=None):
    return client.post(config_url(workspace, project, "test/"), payload or {}, format="json")


class TestRoleMatrix:
    def test_get_not_configured(self, session_client, workspace, project):
        response = session_client.get(config_url(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"is_configured": False}

    @pytest.mark.parametrize("role", [ADMIN, MEMBER])
    def test_get_full_body(self, make_member, workspace, project, integration, role):
        response = make_member(role).get(config_url(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert set(response.data) == READ_FIELDS
        assert response.data["is_configured"] is True
        assert response.data["base_url"] == BASE_URL
        assert response.data["token_hint"] == token_hint(TOKEN)
        assert TOKEN not in json.dumps(response.data, default=str)
        assert integration.api_token_encrypted not in json.dumps(response.data, default=str)

    def test_get_guest_reduced_body(self, make_member, workspace, project, integration):
        response = make_member(GUEST).get(config_url(workspace, project))
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"is_configured": True, "is_enabled": True}

    def test_get_non_member(self, make_member, workspace, project, integration):
        assert make_member(None).get(config_url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN

    def test_get_unauthenticated(self, api_client, workspace, project, integration):
        response = api_client.get(config_url(workspace, project))
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    @pytest.mark.parametrize("role", [MEMBER, GUEST])
    def test_writes_are_admin_only(self, make_member, workspace, project, integration, fake_client, role):
        client = make_member(role)
        assert _put(client, workspace, project, {"is_enabled": False}).status_code == status.HTTP_403_FORBIDDEN
        assert _test(client, workspace, project).status_code == status.HTTP_403_FORBIDDEN
        assert client.delete(config_url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN
        integration.refresh_from_db()
        assert integration.is_enabled is True
        fake_client.constructor.assert_not_called()

    def test_admin_can_write(self, make_member, workspace, project, integration, fake_client):
        response = _put(make_member(ADMIN), workspace, project, {"is_enabled": False})
        assert response.status_code == status.HTTP_200_OK


class TestPutCreate:
    def test_create_without_token(self, session_client, workspace, project):
        response = _put(session_client, workspace, project, {"base_url": BASE_URL})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        assert not ProjectCyberneticsDataIntegration.all_objects.filter(project=project).exists()

    def test_create_without_url(self, session_client, workspace, project):
        response = _put(session_client, workspace, project, {"api_token": TOKEN})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")

    def test_create_with_blank_token(self, session_client, workspace, project, fake_client):
        response = _put(session_client, workspace, project, {"base_url": BASE_URL, "api_token": "   "})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.constructor.assert_not_called()

    def test_create_ok(self, session_client, workspace, project, fake_client):
        response = _put(
            session_client, workspace, project, {"base_url": "https://data.example.com/api/", "api_token": TOKEN}
        )
        assert response.status_code == status.HTTP_200_OK
        assert set(response.data) == READ_FIELDS
        assert response.data["base_url"] == BASE_URL
        assert response.data["last_verified_status"] == "ok"
        assert response.data["token_hint"] == token_hint(TOKEN)
        assert TOKEN not in json.dumps(response.data, default=str)
        fake_client.constructor.assert_called_once_with(BASE_URL, TOKEN)
        stored = ProjectCyberneticsDataIntegration.objects.get(project=project)
        assert stored.workspace_id == workspace.id
        assert stored.api_token_encrypted and TOKEN not in stored.api_token_encrypted
        assert decrypt_token(stored.api_token_encrypted) == TOKEN
        assert stored.token_hint == token_hint(TOKEN)
        assert stored.token_fingerprint == token_fingerprint(TOKEN)
        assert stored.last_verified_at is not None
        assert stored.api_token_encrypted not in json.dumps(response.data, default=str)

    @pytest.mark.parametrize(
        "exc,expected_status",
        [
            (CyberneticsUnauthorized("bad token"), "unauthorized"),
            (CyberneticsUnreachable("down"), "unreachable"),
            (CyberneticsNotFound("gone"), "error"),
        ],
    )
    def test_blocking_verification(self, session_client, workspace, project, fake_client, exc, expected_status):
        fake_client.list_bases.side_effect = exc
        response = _put(session_client, workspace, project, {"base_url": BASE_URL, "api_token": TOKEN})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_VERIFICATION_FAILED")
        assert response.data["error"] == exc.message
        assert response.data["verification"] == {"status": expected_status, "message": exc.message, "bases_visible": 0}
        assert not ProjectCyberneticsDataIntegration.all_objects.filter(project=project).exists()

    def test_empty_verification_message_falls_back(self, session_client, workspace, project, fake_client):
        fake_client.list_bases.side_effect = CyberneticsUnreachable("")
        response = _put(session_client, workspace, project, {"base_url": BASE_URL, "api_token": TOKEN})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_VERIFICATION_FAILED")
        assert response.data["error"] == "Could not verify the connection."

    def test_forbidden_saves_with_warning(self, session_client, workspace, project, fake_client):
        fake_client.list_records.side_effect = CyberneticsForbidden("no record scope")
        response = _put(session_client, workspace, project, {"base_url": BASE_URL, "api_token": TOKEN})
        assert response.status_code == status.HTTP_200_OK
        assert response.data["last_verified_status"] == "forbidden"
        assert response.data["last_verified_message"] == "The token is missing a read scope: no record scope"
        assert ProjectCyberneticsDataIntegration.objects.filter(project=project).exists()

    def test_skip_verification_on_create(self, session_client, workspace, project, fake_client):
        response = _put(
            session_client,
            workspace,
            project,
            {"base_url": BASE_URL, "api_token": TOKEN, "skip_verification": True},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["last_verified_status"] == ""
        assert response.data["last_verified_at"] is None
        fake_client.constructor.assert_not_called()

    def test_ssrf_blocked_url(self, session_client, workspace, project, settings, fake_client):
        settings.CYBERNETICS_DATA_ALLOWED_HOSTS = []
        response = _put(session_client, workspace, project, {"base_url": "https://127.0.0.1", "api_token": TOKEN})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert str(response.data["base_url"][0]).startswith("Invalid or disallowed URL.")
        fake_client.constructor.assert_not_called()


class TestPutUpdate:
    def test_skip_verification_clears_last_verified(
        self, session_client, workspace, project, verified_integration, fake_client
    ):
        response = _put(session_client, workspace, project, {"api_token": NEW_TOKEN, "skip_verification": True})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_not_called()
        verified_integration.refresh_from_db()
        assert verified_integration.last_verified_at is None
        assert verified_integration.last_verified_status == ""
        assert verified_integration.last_verified_message == ""
        assert verified_integration.token_fingerprint == token_fingerprint(NEW_TOKEN)

    def test_new_token_same_url_reverifies(self, session_client, workspace, project, verified_integration, fake_client):
        response = _put(session_client, workspace, project, {"api_token": NEW_TOKEN})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_called_once_with(BASE_URL, NEW_TOKEN)
        assert response.data["token_hint"] == token_hint(NEW_TOKEN)
        verified_integration.refresh_from_db()
        assert decrypt_token(verified_integration.api_token_encrypted) == NEW_TOKEN
        assert verified_integration.token_fingerprint == token_fingerprint(NEW_TOKEN)
        assert verified_integration.last_verified_message == ""

    def test_new_token_failing_verification_keeps_old_token(
        self, session_client, workspace, project, verified_integration, fake_client
    ):
        fake_client.list_bases.side_effect = CyberneticsUnauthorized("bad token")
        response = _put(session_client, workspace, project, {"api_token": NEW_TOKEN})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_VERIFICATION_FAILED")
        verified_integration.refresh_from_db()
        assert decrypt_token(verified_integration.api_token_encrypted) == TOKEN

    def test_url_change_requires_token(self, session_client, workspace, project, verified_integration, fake_client):
        response = _put(session_client, workspace, project, {"base_url": OTHER_URL})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_TOKEN_REQUIRED")
        fake_client.constructor.assert_not_called()
        verified_integration.refresh_from_db()
        assert verified_integration.base_url == BASE_URL

    def test_url_change_with_blank_token(self, session_client, workspace, project, verified_integration, fake_client):
        response = _put(session_client, workspace, project, {"base_url": OTHER_URL, "api_token": ""})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_TOKEN_REQUIRED")
        fake_client.constructor.assert_not_called()

    def test_url_change_with_token_verifies_new_url(
        self, session_client, workspace, project, verified_integration, fake_client
    ):
        response = _put(session_client, workspace, project, {"base_url": OTHER_URL, "api_token": NEW_TOKEN})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_called_once_with(OTHER_URL, NEW_TOKEN)
        verified_integration.refresh_from_db()
        assert verified_integration.base_url == OTHER_URL
        assert decrypt_token(verified_integration.api_token_encrypted) == NEW_TOKEN

    def test_is_enabled_only(self, session_client, workspace, project, verified_integration, fake_client):
        # An unreadable token proves the stored token is never decrypted.
        ProjectCyberneticsDataIntegration.objects.filter(pk=verified_integration.pk).update(
            api_token_encrypted="garbage"
        )
        before = verified_integration.last_verified_at
        response = _put(session_client, workspace, project, {"is_enabled": False})
        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_enabled"] is False
        fake_client.constructor.assert_not_called()
        verified_integration.refresh_from_db()
        assert verified_integration.is_enabled is False
        assert verified_integration.last_verified_at == before
        assert verified_integration.last_verified_status == "ok"
        assert verified_integration.last_verified_message == "previous"
        assert verified_integration.api_token_encrypted == "garbage"

    @pytest.mark.parametrize("url", [BASE_URL, "https://data.example.com/api/"])
    def test_same_url_is_not_a_change(self, session_client, workspace, project, verified_integration, fake_client, url):
        response = _put(session_client, workspace, project, {"base_url": url, "is_enabled": True})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_not_called()
        verified_integration.refresh_from_db()
        assert verified_integration.last_verified_status == "ok"
        assert verified_integration.token_fingerprint == token_fingerprint(TOKEN)

    def test_blank_token_is_no_token(self, session_client, workspace, project, verified_integration, fake_client):
        response = _put(session_client, workspace, project, {"api_token": "", "is_enabled": True})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_not_called()
        verified_integration.refresh_from_db()
        assert decrypt_token(verified_integration.api_token_encrypted) == TOKEN
        assert verified_integration.last_verified_status == "ok"

    def test_update_never_creates_second_row(self, session_client, workspace, project, integration, fake_client):
        for payload in ({"is_enabled": False}, {"api_token": NEW_TOKEN}, {"base_url": OTHER_URL, "api_token": TOKEN}):
            assert _put(session_client, workspace, project, payload).status_code == status.HTTP_200_OK
        rows = ProjectCyberneticsDataIntegration.all_objects.filter(project=project)
        assert list(rows.values_list("id", flat=True)) == [integration.id]

    def test_put_after_disconnect_creates_fresh_row(self, session_client, workspace, project, integration, fake_client):
        assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT
        response = _put(session_client, workspace, project, {"base_url": BASE_URL, "api_token": NEW_TOKEN})
        assert response.status_code == status.HTTP_200_OK
        assert str(response.data["id"]) != str(integration.id)
        assert ProjectCyberneticsDataIntegration.objects.filter(project=project).count() == 1
        assert ProjectCyberneticsDataIntegration.all_objects.filter(project=project).count() == 2
        fake_client.constructor.assert_called_once_with(BASE_URL, NEW_TOKEN)


class TestConnectionTest:
    def test_no_body_uses_stored_values_and_records(
        self, session_client, workspace, project, verified_integration, fake_client
    ):
        fake_client.list_records.side_effect = CyberneticsForbidden("no record scope")
        response = _test(session_client, workspace, project)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == "forbidden"
        fake_client.constructor.assert_called_once_with(BASE_URL, TOKEN)
        verified_integration.refresh_from_db()
        assert verified_integration.last_verified_status == "forbidden"
        assert verified_integration.last_verified_message.startswith("The token is missing a read scope")

    def test_explicit_token_is_not_saved(self, session_client, workspace, project, verified_integration, fake_client):
        response = _test(session_client, workspace, project, {"api_token": NEW_TOKEN})
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"status": "ok", "message": "", "bases_visible": 1}
        fake_client.constructor.assert_called_once_with(BASE_URL, NEW_TOKEN)
        verified_integration.refresh_from_db()
        assert verified_integration.last_verified_message == "previous"
        assert decrypt_token(verified_integration.api_token_encrypted) == TOKEN

    def test_same_url_without_token_uses_stored(
        self, session_client, workspace, project, verified_integration, fake_client
    ):
        response = _test(session_client, workspace, project, {"base_url": "https://data.example.com/api"})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_called_once_with(BASE_URL, TOKEN)
        verified_integration.refresh_from_db()
        assert verified_integration.last_verified_message == ""

    def test_other_url_never_uses_stored_token(self, session_client, workspace, project, integration, fake_client):
        response = _test(session_client, workspace, project, {"base_url": OTHER_URL})
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.constructor.assert_not_called()
        fake_client.list_bases.assert_not_called()

    def test_other_url_with_explicit_token(self, session_client, workspace, project, integration, fake_client):
        response = _test(session_client, workspace, project, {"base_url": OTHER_URL, "api_token": NEW_TOKEN})
        assert response.status_code == status.HTTP_200_OK
        fake_client.constructor.assert_called_once_with(OTHER_URL, NEW_TOKEN)

    def test_no_integration_no_data(self, session_client, workspace, project, fake_client):
        response = _test(session_client, workspace, project)
        assert_error(response, status.HTTP_400_BAD_REQUEST, "CYBERNETICS_BAD_REQUEST")
        fake_client.constructor.assert_not_called()

    def test_no_integration_with_data(self, session_client, workspace, project, fake_client):
        response = _test(session_client, workspace, project, {"base_url": BASE_URL, "api_token": TOKEN})
        assert response.status_code == status.HTTP_200_OK
        assert not ProjectCyberneticsDataIntegration.all_objects.filter(project=project).exists()

    def test_unreadable_stored_token(self, session_client, workspace, project, integration, fake_client):
        ProjectCyberneticsDataIntegration.objects.filter(pk=integration.pk).update(api_token_encrypted="garbage")
        response = _test(session_client, workspace, project)
        assert_error(response, status.HTTP_409_CONFLICT, "CYBERNETICS_TOKEN_UNREADABLE")
        fake_client.constructor.assert_not_called()

    def test_unauthorized_result_is_200(self, session_client, workspace, project, integration, fake_client):
        fake_client.list_bases.side_effect = CyberneticsUnauthorized("bad token")
        response = _test(session_client, workspace, project)
        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"status": "unauthorized", "message": "bad token", "bases_visible": 0}


class TestDelete:
    def test_delete_purges_secret(self, session_client, workspace, project, integration):
        response = session_client.delete(config_url(workspace, project))
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not ProjectCyberneticsDataIntegration.objects.filter(project=project).exists()
        row = ProjectCyberneticsDataIntegration.all_objects.get(pk=integration.pk)
        assert row.deleted_at is not None
        assert row.api_token_encrypted == ""
        assert row.token_hint == ""
        assert row.token_fingerprint == ""
        assert session_client.get(config_url(workspace, project)).data == {"is_configured": False}

    def test_delete_when_not_configured(self, session_client, workspace, project):
        assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT


class TestThrottling:
    @pytest.fixture
    def throttled(self, mocker):
        mocker.patch.object(CyberneticsDataProxyThrottle, "allow_request", return_value=False)
        mocker.patch.object(CyberneticsDataProxyThrottle, "wait", return_value=30)

    def test_put_is_throttled(self, session_client, workspace, project, integration, fake_client, throttled):
        response = _put(session_client, workspace, project, {"is_enabled": False})
        assert_error(response, status.HTTP_429_TOO_MANY_REQUESTS, "CYBERNETICS_RATE_LIMITED")
        assert response["Retry-After"] == "30"
        fake_client.constructor.assert_not_called()

    def test_test_is_throttled(self, session_client, workspace, project, integration, fake_client, throttled):
        response = _test(session_client, workspace, project)
        assert_error(response, status.HTTP_429_TOO_MANY_REQUESTS, "CYBERNETICS_RATE_LIMITED")
        fake_client.constructor.assert_not_called()

    def test_get_and_delete_are_not(self, session_client, workspace, project, integration, throttled):
        assert session_client.get(config_url(workspace, project)).status_code == status.HTTP_200_OK
        assert session_client.delete(config_url(workspace, project)).status_code == status.HTTP_204_NO_CONTENT
