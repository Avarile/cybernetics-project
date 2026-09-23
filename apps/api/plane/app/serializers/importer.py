# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for data import jobs (``Importer``)."""

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import Importer


class ImporterSerializer(BaseSerializer):
    """Import job with nested initiator, project and workspace details."""

    initiated_by_detail = UserLiteSerializer(source="initiated_by", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)
    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)

    class Meta:
        model = Importer
        fields = "__all__"
