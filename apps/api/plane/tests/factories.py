# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import factory
from uuid import uuid4
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueCyberneticsRecord,
    Project,
    ProjectCyberneticsDataIntegration,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.utils.cybernetics_data.secrets import encrypt_token, token_fingerprint, token_hint


class UserFactory(factory.django.DjangoModelFactory):
    """Factory for creating User instances"""

    class Meta:
        model = User
        django_get_or_create = ("email",)

    id = factory.LazyFunction(uuid4)
    email = factory.Sequence(lambda n: f"user{n}@plane.so")
    password = factory.PostGenerationMethodCall("set_password", "password")
    first_name = factory.Sequence(lambda n: f"First{n}")
    last_name = factory.Sequence(lambda n: f"Last{n}")
    is_active = True
    is_superuser = False
    is_staff = False


class WorkspaceFactory(factory.django.DjangoModelFactory):
    """Factory for creating Workspace instances"""

    class Meta:
        model = Workspace
        django_get_or_create = ("slug",)

    id = factory.LazyFunction(uuid4)
    name = factory.Sequence(lambda n: f"Workspace {n}")
    slug = factory.Sequence(lambda n: f"workspace-{n}")
    owner = factory.SubFactory(UserFactory)
    created_at = factory.LazyFunction(timezone.now)
    updated_at = factory.LazyFunction(timezone.now)


class WorkspaceMemberFactory(factory.django.DjangoModelFactory):
    """Factory for creating WorkspaceMember instances"""

    class Meta:
        model = WorkspaceMember

    id = factory.LazyFunction(uuid4)
    workspace = factory.SubFactory(WorkspaceFactory)
    member = factory.SubFactory(UserFactory)
    role = 20  # Admin role by default
    created_at = factory.LazyFunction(timezone.now)
    updated_at = factory.LazyFunction(timezone.now)


class ProjectFactory(factory.django.DjangoModelFactory):
    """Factory for creating Project instances"""

    class Meta:
        model = Project
        django_get_or_create = ("name", "workspace")

    id = factory.LazyFunction(uuid4)
    name = factory.Sequence(lambda n: f"Project {n}")
    workspace = factory.SubFactory(WorkspaceFactory)
    created_by = factory.SelfAttribute("workspace.owner")
    updated_by = factory.SelfAttribute("workspace.owner")
    created_at = factory.LazyFunction(timezone.now)
    updated_at = factory.LazyFunction(timezone.now)


class ProjectMemberFactory(factory.django.DjangoModelFactory):
    """Factory for creating ProjectMember instances"""

    class Meta:
        model = ProjectMember

    id = factory.LazyFunction(uuid4)
    project = factory.SubFactory(ProjectFactory)
    member = factory.SubFactory(UserFactory)
    role = 20  # Admin role by default
    created_at = factory.LazyFunction(timezone.now)
    updated_at = factory.LazyFunction(timezone.now)


class StateFactory(factory.django.DjangoModelFactory):
    """Factory for creating State instances"""

    class Meta:
        model = State

    id = factory.LazyFunction(uuid4)
    name = factory.Sequence(lambda n: f"State {n}")
    color = "#3A3A3A"
    group = "unstarted"
    default = True
    project = factory.SubFactory(ProjectFactory)


class IssueFactory(factory.django.DjangoModelFactory):
    """Factory for creating Issue instances"""

    class Meta:
        model = Issue

    id = factory.LazyFunction(uuid4)
    name = factory.Sequence(lambda n: f"Issue {n}")
    project = factory.SubFactory(ProjectFactory)
    state = factory.SubFactory(StateFactory, project=factory.SelfAttribute("..project"))


class ProjectCyberneticsDataIntegrationFactory(factory.django.DjangoModelFactory):
    """Factory for creating ProjectCyberneticsDataIntegration instances (pass ``token=`` to choose the token)"""

    class Meta:
        model = ProjectCyberneticsDataIntegration

    class Params:
        token = "cybernetics_factory_token_0001"

    id = factory.LazyFunction(uuid4)
    project = factory.SubFactory(ProjectFactory)
    base_url = "https://data.example.com"
    api_token_encrypted = factory.LazyAttribute(lambda o: encrypt_token(o.token))
    token_hint = factory.LazyAttribute(lambda o: token_hint(o.token))
    token_fingerprint = factory.LazyAttribute(lambda o: token_fingerprint(o.token))


class IssueCyberneticsRecordFactory(factory.django.DjangoModelFactory):
    """Factory for creating IssueCyberneticsRecord instances (``created_by`` is kept, unlike a plain save())"""

    class Meta:
        model = IssueCyberneticsRecord

    id = factory.LazyFunction(uuid4)
    issue = factory.SubFactory(IssueFactory)
    project = factory.SelfAttribute("issue.project")
    space_id = "spcAAAAAAAA"
    base_id = "bseAAAAAAAA"
    table_id = "tblAAAAAAAA"
    record_id = factory.Sequence(lambda n: f"rec{n:08d}")
    record_name = factory.Sequence(lambda n: f"Record {n}")
    base_name = "CRM"
    table_name = "Customers"
    source_url = factory.LazyAttribute(
        lambda o: f"https://data.example.com/base/{o.base_id}/table/{o.table_id}?recordId={o.record_id}"
    )
    snapshot_at = factory.LazyFunction(timezone.now)
    status = "ok"

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        # BaseModel.save() overwrites created_by with the request user unless created_by_id is passed.
        created_by = kwargs.pop("created_by", None)
        instance = model_class(*args, **kwargs)
        instance.save(created_by_id=created_by.id if created_by else None)
        return instance
