# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project workflow state views.

``StateViewSet`` handles CRUD for a project's issue states (Backlog, Todo, In
Progress, ...), excluding the hidden triage state used by Intake.
``IntakeStateEndpoint`` returns that triage state. Mutations invalidate the
cached workspace-level state list (``workspaces/:slug/states/``).
"""

# Python imports
from itertools import groupby
from collections import defaultdict

# Django imports
from django.db.utils import IntegrityError

# Third party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet, BaseAPIView
from plane.app.serializers import StateSerializer
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import State, Issue
from plane.utils.cache import invalidate_cache


class StateViewSet(BaseViewSet):
    """CRUD for the (non-triage) workflow states of a project."""

    serializer_class = StateSerializer
    model = State

    def get_queryset(self):
        """Return non-triage states of the project, restricted to active members of a non-archived project."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .filter(is_triage=False)
            .select_related("project")
            .select_related("workspace")
            .distinct()
        )

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Create a state in the project (admin only); duplicate names return 400."""
        try:
            serializer = StateSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def partial_update(self, request, slug, project_id, pk):
        """Partially update a state; duplicate names return 400."""
        try:
            state = State.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
            serializer = StateSerializer(state, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List project states with a computed ``order`` within each group.

        Pass ``?grouped=true`` to get a dict keyed by state group instead of a flat list.
        """
        states = StateSerializer(self.get_queryset(), many=True).data

        # Assign each state a fractional order (index / group size) within its group,
        # so ordering is in (0, 1] regardless of how many states a group has
        grouped_states = defaultdict(list)
        for state in states:
            grouped_states[state["group"]].append(state)

        for group, group_states in grouped_states.items():
            count = len(group_states)

            for index, state in enumerate(group_states, start=1):
                state["order"] = index / count

        grouped = request.GET.get("grouped", False)

        if grouped == "true":
            state_dict = {}
            for key, value in groupby(
                sorted(states, key=lambda state: state["group"]),
                lambda state: state.get("group"),
            ):
                state_dict[str(key)] = list(value)
            return Response(state_dict, status=status.HTTP_200_OK)

        return Response(states, status=status.HTTP_200_OK)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def mark_as_default(self, request, slug, project_id, pk):
        """Make the given state the project's default (admin only), unsetting any previous default."""
        # Select all the states which are marked as default
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, default=True).update(default=False)
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk).update(default=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        """Delete a state (admin only).

        The default state and states that still have issues cannot be deleted.
        """
        state = State.objects.get(is_triage=False, pk=pk, project_id=project_id, workspace__slug=slug)

        if state.default:
            return Response(
                {"error": "Default state cannot be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for any issues in the state
        issue_exist = Issue.objects.filter(state=pk).exists()

        if issue_exist:
            return Response(
                {"error": "The state is not empty, only empty states can be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        state.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IntakeStateEndpoint(BaseAPIView):
    """Expose the project's hidden triage state used by Intake."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Return the triage state of the project, or 404 if it does not exist."""
        # triage_objects is a manager that only returns is_triage=True states
        state = State.triage_objects.filter(workspace__slug=slug, project_id=project_id).first()
        if not state:
            return Response(
                {"error": "Triage state not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(StateSerializer(state).data, status=status.HTTP_200_OK)
