# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Hooks that run after a user successfully signs in or signs up."""

from .workspace_project_join import process_workspace_project_invitations


def post_user_auth_workflow(user, is_signup, request):
    """Run post-authentication steps; currently accepts pending workspace/project invitations for the user."""
    process_workspace_project_invitations(user=user)
