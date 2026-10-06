# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
End-to-end tests for the project management MCP tools (projects, members, intake triage,
estimates, module archiving) through the loopback into the real /api/v1 views.
"""

import pytest
from asgiref.sync import sync_to_async

from plane.db.models import (
    DEFAULT_STATES,
    Intake,
    IntakeIssue,
    Issue,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.tests.contract.mcp.test_mcp_endpoint import call_tool, connect, mcp_app, payload, token  # noqa: F401

pytestmark = [pytest.mark.contract, pytest.mark.anyio, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def app(mcp_app, mocker):  # noqa: F811
    """``mcp_app`` plus mocks for the background tasks the project, intake and module views (and soft deletes) queue."""
    for target in (
        "plane.api.views.project.model_activity.delay",
        "plane.api.views.project.webhook_activity.delay",
        "plane.api.views.intake.issue_activity.delay",
        "plane.api.views.module.issue_activity.delay",
        "plane.api.views.module.model_activity.delay",
        "plane.db.mixins.soft_delete_related_objects.delay",
    ):
        mocker.patch(target)
    return mcp_app


async def create_project(client, token, workspace, **extra):  # noqa: F811
    """Create a project through MCP and return its payload."""
    arguments = {"workspace_slug": workspace.slug, "name": "Launch", "identifier": "LCH", **extra}
    return payload(await call_tool(client, token, "create_project", arguments))


class TestProjects:
    async def test_create_project_seeds_states_admin_and_intake(self, app, token, workspace, create_user):  # noqa: F811
        async with connect(app) as client:
            created = await create_project(client, token, workspace, intake_enabled=True)

        project = await Project.objects.aget(pk=created["id"])
        assert project.cycle_view and project.module_view and project.intake_view
        assert await State.all_state_objects.filter(project=project).acount() == len(DEFAULT_STATES)
        assert await ProjectMember.objects.filter(project=project, member=create_user, role=20).aexists()
        assert await Intake.objects.filter(project=project, is_default=True).aexists()

    async def test_delete_project_requires_matching_identifier(self, app, token, workspace):  # noqa: F811
        async with connect(app) as client:
            created = await create_project(client, token, workspace)
            base = {"workspace_slug": workspace.slug, "project_id": created["id"]}
            refused = await call_tool(client, token, "delete_project", {**base, "confirm_identifier": "NOPE"})
            assert await Project.objects.filter(pk=created["id"]).aexists()
            payload(await call_tool(client, token, "delete_project", {**base, "confirm_identifier": "lch"}))

        assert refused["isError"] is True
        assert "does not match" in refused["content"][0]["text"]
        assert not await Project.objects.filter(pk=created["id"]).aexists()


class TestMembers:
    async def test_add_update_and_remove_member_by_user_id(self, app, token, workspace):  # noqa: F811
        def teammate():
            user = User.objects.create(email="teammate@plane.so", username="teammate")
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
            return user

        user = await sync_to_async(teammate)()

        async with connect(app) as client:
            project = await create_project(client, token, workspace)
            base = {"workspace_slug": workspace.slug, "project_id": project["id"], "user_id": str(user.id)}
            payload(await call_tool(client, token, "add_project_member", {**base, "role": "member"}))
            payload(await call_tool(client, token, "update_project_member", {**base, "role": "admin"}))
            membership = await ProjectMember.objects.aget(project_id=project["id"], member=user)
            assert membership.role == 20
            payload(await call_tool(client, token, "remove_project_member", base))

        await membership.arefresh_from_db()
        assert membership.is_active is False


class TestIntake:
    async def test_submit_and_accept(self, app, token, workspace):  # noqa: F811
        async with connect(app) as client:
            project = await create_project(client, token, workspace, intake_enabled=True)
            base = {"workspace_slug": workspace.slug, "project_id": project["id"]}
            payload(await call_tool(client, token, "create_intake_work_item", {**base, "name": "Crash on login"}))
            queue = payload(await call_tool(client, token, "list_intake_work_items", base))
            work_item_id = queue["results"][0]["issue"]
            payload(
                await call_tool(
                    client, token, "triage_intake_work_item", {**base, "work_item_id": work_item_id, "action": "accept"}
                )
            )

        assert (await IntakeIssue.objects.aget(issue_id=work_item_id)).status == 1


class TestEstimates:
    async def test_estimate_flow_sets_points_on_work_items(self, app, token, workspace):  # noqa: F811
        async with connect(app) as client:
            project = await create_project(client, token, workspace)
            base = {"workspace_slug": workspace.slug, "project_id": project["id"]}
            estimate = payload(
                await call_tool(client, token, "create_estimate", {**base, "name": "Story points", "type": "points"})
            )
            points = payload(
                await call_tool(
                    client,
                    token,
                    "create_estimate_points",
                    {
                        **base,
                        "estimate_id": estimate["id"],
                        "points": [{"key": 0, "value": "1"}, {"key": 1, "value": "3"}],
                    },
                )
            )["results"]
            payload(await call_tool(client, token, "update_project", {**base, "estimate_id": estimate["id"]}))
            item = payload(
                await call_tool(
                    client,
                    token,
                    "create_work_item",
                    {**base, "name": "Sized task", "estimate_point_id": points[1]["id"]},
                )
            )

        assert str((await Issue.objects.aget(pk=item["id"])).estimate_point_id) == points[1]["id"]


class TestModules:
    async def test_only_finished_modules_can_be_archived(self, app, token, workspace):  # noqa: F811
        async with connect(app) as client:
            project = await create_project(client, token, workspace)
            base = {"workspace_slug": workspace.slug, "project_id": project["id"]}
            module = payload(
                await call_tool(client, token, "create_module", {**base, "name": "Auth", "status": "in-progress"})
            )
            refused = await call_tool(client, token, "archive_module", {**base, "module_id": module["id"]})

        assert refused["isError"] is True
        assert "Only completed or cancelled modules can be archived" in refused["content"][0]["text"]
