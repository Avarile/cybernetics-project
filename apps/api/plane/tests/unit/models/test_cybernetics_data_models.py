# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.bgtasks.deletion_task import soft_delete_related_objects
from plane.db.models import IssueCyberneticsRecord, ProjectCyberneticsDataIntegration
from plane.tests.factories import (
    IssueCyberneticsRecordFactory,
    IssueFactory,
    ProjectCyberneticsDataIntegrationFactory,
)

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def no_celery(mocker):
    return mocker.patch("plane.db.mixins.soft_delete_related_objects.delay")


class TestProjectCyberneticsDataIntegration:
    def test_one_active_integration_per_project(self):
        integration = ProjectCyberneticsDataIntegrationFactory()
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                ProjectCyberneticsDataIntegrationFactory(project=integration.project)

    def test_new_integration_allowed_after_soft_delete(self):
        integration = ProjectCyberneticsDataIntegrationFactory()
        integration.delete()
        fresh = ProjectCyberneticsDataIntegrationFactory(project=integration.project)
        assert ProjectCyberneticsDataIntegration.objects.get(project=integration.project) == fresh
        assert ProjectCyberneticsDataIntegration.all_objects.filter(project=integration.project).count() == 2

    def test_workspace_filled_from_project(self):
        integration = ProjectCyberneticsDataIntegrationFactory()
        assert integration.workspace_id == integration.project.workspace_id

    def test_defaults(self):
        integration = ProjectCyberneticsDataIntegrationFactory()
        integration.refresh_from_db()
        assert integration.is_enabled is True
        assert integration.last_verified_status == ""
        assert integration.last_verified_message == ""
        assert integration.last_verified_at is None

    def test_str(self):
        integration = ProjectCyberneticsDataIntegrationFactory(base_url="https://data.example.com")
        assert str(integration) == f"{integration.project_id} https://data.example.com"

    def test_ordering(self):
        old = ProjectCyberneticsDataIntegrationFactory()
        new = ProjectCyberneticsDataIntegrationFactory()
        ProjectCyberneticsDataIntegration.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=1)
        )
        assert list(ProjectCyberneticsDataIntegration.objects.filter(pk__in=[old.pk, new.pk])) == [new, old]


class TestIssueCyberneticsRecord:
    def test_one_active_row_per_issue_table_record(self):
        row = IssueCyberneticsRecordFactory()
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                IssueCyberneticsRecordFactory(issue=row.issue, table_id=row.table_id, record_id=row.record_id)

    def test_other_table_is_allowed(self):
        row = IssueCyberneticsRecordFactory()
        IssueCyberneticsRecordFactory(issue=row.issue, table_id="tblBBBBBBBB", record_id=row.record_id)
        assert IssueCyberneticsRecord.objects.filter(issue=row.issue).count() == 2

    def test_allowed_after_soft_delete(self):
        row = IssueCyberneticsRecordFactory()
        row.delete()
        IssueCyberneticsRecordFactory(issue=row.issue, table_id=row.table_id, record_id=row.record_id)
        assert IssueCyberneticsRecord.objects.filter(issue=row.issue).count() == 1
        assert IssueCyberneticsRecord.all_objects.filter(issue=row.issue).count() == 2

    def test_same_record_on_another_issue(self):
        row = IssueCyberneticsRecordFactory()
        other_issue = IssueFactory(project=row.project)
        IssueCyberneticsRecordFactory(issue=other_issue, table_id=row.table_id, record_id=row.record_id)
        assert IssueCyberneticsRecord.objects.filter(record_id=row.record_id).count() == 2

    def test_workspace_filled_from_project(self):
        row = IssueCyberneticsRecordFactory()
        assert row.workspace_id == row.issue.project.workspace_id

    def test_defaults(self):
        issue = IssueFactory()
        row = IssueCyberneticsRecord.objects.create(
            issue=issue, project=issue.project, base_id="bseAAAAAAAA", table_id="tblAAAAAAAA", record_id="recAAAAAAAA"
        )
        row.refresh_from_db()
        assert row.status == "ok"
        assert row.preview == {}
        assert row.view_id == ""
        assert row.record_name == ""
        assert row.snapshot_at is None

    def test_str(self):
        row = IssueCyberneticsRecordFactory(table_id="tblAAAAAAAA", record_id="recAAAAAAAA")
        assert str(row) == f"{row.issue_id} tblAAAAAAAA/recAAAAAAAA"

    def test_ordering(self):
        old = IssueCyberneticsRecordFactory()
        new = IssueCyberneticsRecordFactory(issue=old.issue)
        IssueCyberneticsRecord.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=1))
        assert list(IssueCyberneticsRecord.objects.filter(issue=old.issue)) == [new, old]

    def test_soft_deleting_issue_cascades(self, no_celery):
        # Run the soft-delete cascade inline instead of on Celery.
        no_celery.side_effect = lambda *args, **kwargs: soft_delete_related_objects(*args, **kwargs)
        row = IssueCyberneticsRecordFactory()
        row.issue.delete()
        assert not IssueCyberneticsRecord.objects.filter(pk=row.pk).exists()
        assert IssueCyberneticsRecord.all_objects.get(pk=row.pk).deleted_at is not None
