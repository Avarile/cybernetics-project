# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``create_project_member``: add a workspace member to a project.

Usage: ``python manage.py create_project_member --project_id <uuid> --user_email <email> [--role <int>]``.
The user must already be an active member of the project's workspace. Existing
(possibly inactive) memberships are re-activated with the given role.
"""

# Django imports
from typing import Any
from django.core.management import BaseCommand, CommandError

# Module imports
from plane.db.models import (
    User,
    WorkspaceMember,
    ProjectMember,
    Project,
    ProjectUserProperty,
)


class Command(BaseCommand):
    """Create or re-activate a ``ProjectMember`` for a user already in the workspace."""

    help = "Add a member to a project. If present in the workspace"

    def add_arguments(self, parser):
        # Positional argument
        parser.add_argument("--project_id", type=str, nargs="?", help="Project ID")
        parser.add_argument("--user_email", type=str, nargs="?", help="User Email")
        parser.add_argument("--role", type=int, nargs="?", help="Role of the user in the project")

    def handle(self, *args: Any, **options: Any):
        """Validate inputs, upsert the project membership and ensure a ``ProjectUserProperty`` row.

        Validation errors are printed rather than raised.
        """
        try:
            if not options["project_id"]:
                raise CommandError("Project ID is required")
            if not options["user_email"]:
                raise CommandError("User Email is required")

            project_id = options["project_id"]
            user_email = options["user_email"]
            # Plane roles: 20 = Admin, 15 = Member, 5 = Guest. Note the key is always
            # present in options (argparse default None), so the 20 fallback rarely applies.
            role = options.get("role", 20)

            print(f"Role: {role}")

            user = User.objects.filter(email=user_email).first()
            if not user:
                raise CommandError("User not found")

            # Check if the project exists
            project = Project.objects.filter(pk=project_id).first()
            if not project:
                raise CommandError("Project not found")

            # Check if the user exists in the workspace
            if not WorkspaceMember.objects.filter(workspace=project.workspace, member=user, is_active=True).exists():
                raise CommandError("User not member in workspace")


            if ProjectMember.objects.filter(project=project, member=user).exists():
                # Update the project member
                ProjectMember.objects.filter(project=project, member=user).update(
                    is_active=True, role=role
                )
            else:
                # Create the project member
                ProjectMember.objects.create(project=project, member=user, role=role)

            # Per-user project view preferences (filters, display properties)
            ProjectUserProperty.objects.get_or_create(user=user, project=project)

            # Success message
            self.stdout.write(self.style.SUCCESS(f"User {user_email} added to project {project_id}"))
            return
        except CommandError as e:
            self.stdout.write(self.style.ERROR(e))
            return
