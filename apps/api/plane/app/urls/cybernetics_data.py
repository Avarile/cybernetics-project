# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the Cybernetics Data integration of a project.

- configuration and connection test of the external data service,
- read-only proxy endpoints to browse its databases, tables, schemas and records,
- attaching/refreshing/removing external records on a work item.
"""

from django.urls import path

from plane.app.views import (
    CyberneticsDatabasesEndpoint,
    CyberneticsRecordDetailEndpoint,
    CyberneticsRecordsEndpoint,
    CyberneticsTableSchemaEndpoint,
    CyberneticsTablesEndpoint,
    IssueCyberneticsRecordViewSet,
    ProjectCyberneticsDataEndpoint,
    ProjectCyberneticsDataTestEndpoint,
)

# Common prefix for all project-scoped routes in this module
_PROJECT = "workspaces/<str:slug>/projects/<uuid:project_id>"

urlpatterns = [
    # Configuration
    path(
        f"{_PROJECT}/cybernetics-data/",
        ProjectCyberneticsDataEndpoint.as_view(),
        name="project-cybernetics-data",
    ),
    path(
        f"{_PROJECT}/cybernetics-data/test/",
        ProjectCyberneticsDataTestEndpoint.as_view(),
        name="project-cybernetics-data-test",
    ),
    # Browse proxy (read-only)
    path(
        f"{_PROJECT}/cybernetics-data/databases/",
        CyberneticsDatabasesEndpoint.as_view(),
        name="project-cybernetics-data-databases",
    ),
    path(
        f"{_PROJECT}/cybernetics-data/bases/<str:base_id>/tables/",
        CyberneticsTablesEndpoint.as_view(),
        name="project-cybernetics-data-tables",
    ),
    path(
        f"{_PROJECT}/cybernetics-data/tables/<str:table_id>/schema/",
        CyberneticsTableSchemaEndpoint.as_view(),
        name="project-cybernetics-data-table-schema",
    ),
    path(
        f"{_PROJECT}/cybernetics-data/tables/<str:table_id>/records/",
        CyberneticsRecordsEndpoint.as_view(),
        name="project-cybernetics-data-records",
    ),
    path(
        f"{_PROJECT}/cybernetics-data/tables/<str:table_id>/records/<str:record_id>/",
        CyberneticsRecordDetailEndpoint.as_view(),
        name="project-cybernetics-data-record",
    ),
    # Work-item attachments
    path(
        f"{_PROJECT}/issues/<uuid:issue_id>/cybernetics-records/",
        IssueCyberneticsRecordViewSet.as_view({"get": "list", "post": "create"}),
        name="project-issue-cybernetics-records",
    ),
    path(
        f"{_PROJECT}/issues/<uuid:issue_id>/cybernetics-records/refresh/",
        IssueCyberneticsRecordViewSet.as_view({"post": "refresh"}),
        name="project-issue-cybernetics-records-refresh",
    ),
    path(
        f"{_PROJECT}/issues/<uuid:issue_id>/cybernetics-records/<uuid:pk>/",
        IssueCyberneticsRecordViewSet.as_view({"delete": "destroy"}),
        name="project-issue-cybernetics-record",
    ),
]
