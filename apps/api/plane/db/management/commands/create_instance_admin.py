# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``create_instance_admin``: grant instance-admin rights to a user.

Usage: ``python manage.py create_instance_admin <email>``. Creates an
``InstanceAdmin`` (role 20) row linking an existing user to the current
``Instance`` (the ``plane.license`` app), which gives access to god-mode/admin.
"""

# Django imports
from django.core.management.base import BaseCommand, CommandError

# Module imports
from plane.license.models import Instance, InstanceAdmin
from plane.db.models import User


class Command(BaseCommand):
    """Promote an existing user to instance admin."""

    help = "Add a new instance admin"

    def add_arguments(self, parser):
        # Positional argument
        parser.add_argument("admin_email", type=str, help="Instance Admin Email")

    def handle(self, *args, **options):
        """Validate the email, then create the ``InstanceAdmin`` record; fail if it already exists."""
        admin_email = options.get("admin_email", False)

        if not admin_email:
            raise CommandError("Please provide the email of the admin.")

        user = User.objects.filter(email=admin_email).first()
        if user is None:
            raise CommandError("User with the provided email does not exist.")

        try:
            # Get the instance (a deployment normally has a single Instance row)
            instance = Instance.objects.last()

            # Get or create an instance admin
            _, created = InstanceAdmin.objects.get_or_create(user=user, instance=instance, role=20)

            # Note: this CommandError is caught by the generic handler below and re-raised
            # as "Failed to create the instance admin."
            if not created:
                raise CommandError("The provided email is already an instance admin.")

            self.stdout.write(self.style.SUCCESS("Successfully created the admin"))
        except Exception as e:
            print(e)
            raise CommandError("Failed to create the instance admin.")
