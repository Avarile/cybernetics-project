# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the Cybernetics-Data record activity handlers in issue_activities_task.

Checks the human-readable record label, the create/delete handlers that build
IssueActivity objects, and the full ``issue_activity`` task persisting a row.
"""

import json
from uuid import uuid4

import pytest

from plane.bgtasks.issue_activities_task import (
    _cybernetics_record_label,
    create_cybernetics_record_activity,
    delete_cybernetics_record_activity,
    issue_activity,
)
from plane.db.models import IssueActivity
from plane.tests.factories import IssueFactory, UserFactory

# Serialized IssueCyberneticsRecord payload as passed to the activity task.
ROW = {
    "id": "7f4c0a8e-0000-4000-8000-000000000001",
    "table_name": "Customers",
    "record_name": "ACME",
    "record_id": "recAAAAAAAA",
}


@pytest.mark.unit
class TestLabel:
    """_cybernetics_record_label: "table / record", falling back to record_id, then empty."""

    @pytest.mark.parametrize(
        "data,expected",
        [
            ({"table_name": "T", "record_name": "R", "record_id": "recX"}, "T / R"),
            ({"table_name": "", "record_name": "R"}, "R"),
            ({"record_name": "R"}, "R"),
            ({"table_name": "T", "record_name": "", "record_id": "recX"}, "T / recX"),
            ({"record_id": "recX"}, "recX"),
            ({}, ""),
            (None, ""),
        ],
    )
    def test_label(self, data, expected):
        assert _cybernetics_record_label(data) == expected


def _ids():
    """Random issue/project/workspace/actor IDs passed as keyword args to the handlers."""
    return {"issue_id": uuid4(), "project_id": uuid4(), "workspace_id": uuid4(), "actor_id": uuid4()}


@pytest.mark.unit
class TestHandlers:
    """Handlers append an unsaved IssueActivity to ``issue_activities`` without touching the DB."""

    def test_create(self):
        """Attaching a record produces a "created" activity with the label as new_value."""
        ids, activities = _ids(), []
        create_cybernetics_record_activity(
            requested_data=json.dumps(ROW), current_instance=None, issue_activities=activities, epoch=123, **ids
        )
        assert len(activities) == 1
        activity = activities[0]
        assert isinstance(activity, IssueActivity)
        assert activity.field == "cybernetics_record"
        assert activity.verb == "created"
        assert activity.comment == "attached a database record"
        assert activity.new_value == "Customers / ACME"
        assert str(activity.new_identifier) == ROW["id"]
        assert activity.epoch == 123
        assert (activity.issue_id, activity.project_id, activity.workspace_id, activity.actor_id) == (
            ids["issue_id"],
            ids["project_id"],
            ids["workspace_id"],
            ids["actor_id"],
        )

    def test_delete(self):
        """Removing a record produces a "deleted" activity carrying the old label and ID."""
        ids, activities = _ids(), []
        delete_cybernetics_record_activity(
            requested_data=json.dumps({"id": ROW["id"]}),
            current_instance=json.dumps(ROW),
            issue_activities=activities,
            epoch=456,
            **ids,
        )
        assert len(activities) == 1
        activity = activities[0]
        assert activity.field == "cybernetics_record"
        assert activity.verb == "deleted"
        assert activity.comment == "removed a database record"
        assert activity.old_value == "Customers / ACME"
        assert activity.new_value == ""
        assert str(activity.old_identifier) == ROW["id"]
        assert activity.epoch == 456
        assert activity.issue_id == ids["issue_id"]


@pytest.mark.unit
@pytest.mark.django_db
class TestIssueActivityTask:
    """End-to-end ``issue_activity`` task for cybernetics_record activity types."""

    @pytest.fixture(autouse=True)
    def no_side_effects(self, mocker):
        """Mock Redis and the notifications task; returns the notifications.delay mock."""
        mocker.patch("plane.bgtasks.issue_activities_task.redis_instance")
        return mocker.patch("plane.bgtasks.issue_activities_task.notifications.delay")

    def test_created_writes_one_row(self, no_side_effects):
        """A created event persists one activity row and triggers a notification."""
        issue = IssueFactory()
        actor = UserFactory()
        # The task swallows exceptions, so assert on database state.
        issue_activity(
            type="cybernetics_record.activity.created",
            requested_data=json.dumps(ROW),
            current_instance=None,
            issue_id=str(issue.id),
            actor_id=str(actor.id),
            project_id=str(issue.project_id),
            epoch=1700000000,
            notification=True,
            origin="https://app.example.com",
        )
        rows = IssueActivity.objects.filter(issue=issue, field="cybernetics_record")
        assert rows.count() == 1
        row = rows.get()
        assert (row.verb, row.new_value, str(row.new_identifier)) == ("created", "Customers / ACME", ROW["id"])
        assert row.workspace_id == issue.workspace_id
        assert row.actor_id == actor.id
        no_side_effects.assert_called_once()

    def test_deleted_writes_one_row(self):
        """A deleted event persists one activity row with the old record label."""
        issue = IssueFactory()
        actor = UserFactory()
        issue_activity(
            type="cybernetics_record.activity.deleted",
            requested_data=json.dumps({"id": ROW["id"]}),
            current_instance=json.dumps(ROW),
            issue_id=str(issue.id),
            actor_id=str(actor.id),
            project_id=str(issue.project_id),
            epoch=1700000000,
        )
        row = IssueActivity.objects.get(issue=issue, field="cybernetics_record")
        assert (row.verb, row.old_value, str(row.old_identifier)) == ("deleted", "Customers / ACME", ROW["id"])
