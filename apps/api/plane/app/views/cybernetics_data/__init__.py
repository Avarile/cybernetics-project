# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Views for the project-level Cybernetics-Data (cy-database) integration.

Re-exports the browse proxy, connection config and work-item record
attachment views so URL modules can import them from one place.
"""

from .browse import (
    CyberneticsDatabasesEndpoint,
    CyberneticsRecordDetailEndpoint,
    CyberneticsRecordsEndpoint,
    CyberneticsTableSchemaEndpoint,
    CyberneticsTablesEndpoint,
)
from .config import ProjectCyberneticsDataEndpoint, ProjectCyberneticsDataTestEndpoint
from .records import IssueCyberneticsRecordViewSet
