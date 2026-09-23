# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Fixtures shared by the Cybernetics-Data contract tests.

Loaded with ``pytest_plugins = ["plane.tests.contract.app.conftest_cybernetics"]``.
Nothing here is autouse: plugin fixtures are global, so each contract module
opts into ``isolate`` with its own autouse wrapper.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from django.utils import timezone

from plane.db.models import ProjectMember, User, WorkspaceMember
from plane.tests.factories import (
    IssueFactory,
    ProjectCyberneticsDataIntegrationFactory,
    ProjectFactory,
    StateFactory,
)
from plane.tests.unit.cybernetics_data.fakes import DictCache
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data import service

# Dummy integration credentials; the token mimics the ``cybernetics_<id>_<secret>`` shape.
TOKEN = "cybernetics_tok123_c2VjcmV0c2lnbmF0dXJl"
BASE_URL = "https://data.example.com"

# Plane role values used for ProjectMember / WorkspaceMember.role.
ADMIN, MEMBER, GUEST = 20, 15, 5


def config_url(workspace, project, suffix=""):
    """Build a project-level Cybernetics-Data config/browse URL, optionally with a sub-path ``suffix``."""
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/cybernetics-data/{suffix}"


def records_url(workspace, project, issue, suffix=""):
    """Build the URL for the records linked to ``issue``, optionally with a sub-path ``suffix``."""
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/cybernetics-records/{suffix}"


def assert_error(response, status_code, error_message):
    """Assert the ``{error, error_code, error_message}`` envelope."""
    from plane.utils.error_codes import ERROR_CODES

    assert response.status_code == status_code, response.data
    assert response.data["error_message"] == error_message
    assert response.data["error_code"] == ERROR_CODES[error_message]
    assert response.data["error"]


@pytest.fixture
def isolate(monkeypatch, mocker, settings):
    """Instance settings, deterministic caches and no Celery. Returns the ``issue_activity.delay`` mock."""
    settings.CYBERNETICS_DATA_ENABLED = True
    settings.CYBERNETICS_DATA_ALLOWED_HOSTS = ["data.example.com", "other.example.com"]
    settings.CYBERNETICS_DATA_ALLOWED_IPS = []
    # Swap the shared Django caches for in-memory dicts so cached lookups and throttle
    # counters never leak between tests.
    monkeypatch.setattr(service, "cache", DictCache())
    monkeypatch.setattr(CyberneticsDataProxyThrottle, "cache", DictCache())
    # Soft-deletes normally fan out to a Celery task; stub it so no broker is needed.
    mocker.patch("plane.db.mixins.soft_delete_related_objects.delay")
    return mocker.patch("plane.app.views.cybernetics_data.records.issue_activity.delay")


@pytest.fixture
def project(workspace, create_user):
    """The primary project ("WEB"), with ``create_user`` as an admin member."""
    project = ProjectFactory(name="Web", identifier="WEB", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=ADMIN, is_active=True)
    return project


@pytest.fixture
def other_project(workspace, create_user):
    """A second project ("OPS") in the same workspace, used for cross-project isolation checks."""
    project = ProjectFactory(name="Ops", identifier="OPS", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=ADMIN, is_active=True)
    return project


@pytest.fixture
def state(project):
    """A "Todo" workflow state in ``project``."""
    return StateFactory(project=project, name="Todo")


@pytest.fixture
def issue(project, state):
    """An active work item in ``project`` that records can be linked to."""
    return IssueFactory(project=project, state=state, name="Fix it")


@pytest.fixture
def archived_issue(project, state):
    """An archived work item, for asserting that archived issues are handled differently."""
    return IssueFactory(project=project, state=state, name="Old", archived_at=timezone.now().date())


@pytest.fixture
def integration(project):
    """A saved Cybernetics-Data integration for ``project`` pointing at ``BASE_URL``."""
    return ProjectCyberneticsDataIntegrationFactory(project=project, base_url=BASE_URL, token=TOKEN)


@pytest.fixture
def make_member(workspace, project, api_client):
    """``make_member(role)`` → an API client authenticated as a new user with that project role.

    ``role=None`` makes a workspace member who is not in the project.
    """

    def _make(role, target_project=None):
        user = User.objects.create(email=f"{uuid4().hex[:8]}@example.com", username=uuid4().hex[:12])
        # Workspace role mirrors the project role: member-or-above gets MEMBER, otherwise GUEST.
        WorkspaceMember.objects.create(
            workspace=workspace, member=user, role=MEMBER if (role or 0) >= MEMBER else GUEST
        )
        if role is not None:
            ProjectMember.objects.create(project=target_project or project, member=user, role=role, is_active=True)
        # Note: this re-authenticates the shared ``api_client``, so the last call wins.
        api_client.force_authenticate(user=user)
        api_client.user = user
        return api_client

    return _make


@pytest.fixture
def fake_client(mocker):
    """A ``MagicMock`` client returned by ``service.client_for`` and the config view's client class.

    ``fake_client.constructor`` is the patched ``CyberneticsDataClient`` class used by the config view.
    """
    client = MagicMock()
    client.list_bases.return_value = [{"id": "bseAAAAAAAA", "name": "CRM", "spaceId": "spcAAAAAAAA"}]
    client.list_spaces.return_value = [{"id": "spcAAAAAAAA", "name": "Marketing"}]
    client.list_tables.return_value = [{"id": "tblAAAAAAAA", "name": "Customers"}]
    client.get_table.return_value = {"id": "tblAAAAAAAA", "name": "Customers"}
    client.get_base.return_value = {"id": "bseAAAAAAAA", "name": "CRM", "spaceId": "spcAAAAAAAA"}
    client.list_fields.return_value = [
        {"id": "fldPRIMARY01", "name": "Name", "type": "singleLineText", "isPrimary": True},
        {"id": "fldEMAIL0001", "name": "Email", "type": "singleLineText"},
    ]
    client.list_views.return_value = []
    client.list_records.return_value = {"records": []}
    client.row_count.return_value = 0
    client.get_record.return_value = {
        "id": "recAAAAAAAA",
        "name": "ACME",
        "fields": {"fldPRIMARY01": "ACME", "fldEMAIL0001": "a@acme.com"},
    }
    mocker.patch("plane.utils.cybernetics_data.service.client_for", return_value=client)
    client.constructor = mocker.patch(
        "plane.app.views.cybernetics_data.config.CyberneticsDataClient", return_value=client
    )
    return client
