# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from typing import Any, Optional
from uuid import UUID

# Compact projection for work item lists (the public API's ?fields= parameter)
WORK_ITEM_LIST_FIELDS = "id,sequence_id,name,state,priority,assignees,labels,parent,start_date,target_date,updated_at"


def project_path(workspace_slug: str, project_id: UUID) -> str:
    return f"workspaces/{workspace_slug}/projects/{project_id}"


def work_item_path(workspace_slug: str, project_id: UUID, work_item_id: UUID) -> str:
    return f"{project_path(workspace_slug, project_id)}/work-items/{work_item_id}"


def page_params(cursor: Optional[str], per_page: int, **extra: Any) -> dict:
    return {"cursor": cursor, "per_page": per_page, **extra}


def compact(**values: Any) -> dict:
    """Drop arguments the caller did not set, and stringify UUIDs for the JSON payload."""

    def convert(value):
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, list):
            return [convert(v) for v in value]
        return value

    return {key: convert(value) for key, value in values.items() if value is not None}
