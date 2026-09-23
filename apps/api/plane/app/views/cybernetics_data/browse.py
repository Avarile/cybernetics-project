# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Read-only proxy used by the work-item "Database" browser."""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data import service
from plane.utils.cybernetics_data.client import CyberneticsDataClient
from plane.utils.cybernetics_data.filters import (
    QueryValidationError,
    parse_filter,
    parse_int,
    parse_order_by,
    parse_search,
    validate_id,
)
from .base import CyberneticsDataErrorMixin


class CyberneticsDataBrowseBaseEndpoint(CyberneticsDataErrorMixin, BaseAPIView):
    throttle_classes = [CyberneticsDataProxyThrottle]

    def _required_id(self, request, name, kind):
        value = request.query_params.get(name)
        if not value:
            raise QueryValidationError(f"{name} is required")
        return validate_id(value, kind)

    def _optional_id(self, request, name, kind):
        value = request.query_params.get(name)
        return validate_id(value, kind) if value else None


class CyberneticsDatabasesEndpoint(CyberneticsDataBrowseBaseEndpoint):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        integration, client = service.get_client(slug, project_id)
        return Response(service.list_databases(integration, client), status=status.HTTP_200_OK)


class CyberneticsTablesEndpoint(CyberneticsDataBrowseBaseEndpoint):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, base_id):
        validate_id(base_id, "base")
        integration, client = service.get_client(slug, project_id)
        return Response(service.list_tables(integration, client, base_id), status=status.HTTP_200_OK)


class CyberneticsTableSchemaEndpoint(CyberneticsDataBrowseBaseEndpoint):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, table_id):
        validate_id(table_id, "table")
        base_id = self._required_id(request, "base_id", "base")
        view_id = self._optional_id(request, "view_id", "view")
        integration, client = service.get_client(slug, project_id)
        return Response(
            service.get_schema(integration, client, base_id, table_id, view_id),
            status=status.HTTP_200_OK,
        )


class CyberneticsRecordsEndpoint(CyberneticsDataBrowseBaseEndpoint):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, table_id):
        validate_id(table_id, "table")
        params = request.query_params
        base_id = self._required_id(request, "base_id", "base")
        view_id = self._optional_id(request, "view_id", "view")
        search_field = self._optional_id(request, "search_field", "field")
        take = parse_int(params.get("take"), 50, 1, CyberneticsDataClient.MAX_TAKE)
        skip = parse_int(params.get("skip"), 0, 0, 10_000_000)
        search = parse_search(params.get("search"))
        filter_ = parse_filter(params.get("filter"))
        order_by = parse_order_by(params.get("order_by"))
        with_total = params.get("with_total", "false").lower() in ("1", "true", "yes")

        integration, client = service.get_client(slug, project_id)
        data = service.list_records(
            integration,
            client,
            base_id,
            table_id,
            take=take,
            skip=skip,
            view_id=view_id,
            search=search,
            search_field=search_field,
            filter_=filter_,
            order_by=order_by,
            with_total=with_total,
        )
        return Response(data, status=status.HTTP_200_OK)


class CyberneticsRecordDetailEndpoint(CyberneticsDataBrowseBaseEndpoint):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, table_id, record_id):
        validate_id(table_id, "table")
        validate_id(record_id, "record")
        base_id = self._required_id(request, "base_id", "base")
        cell_format = request.query_params.get("cell_format", "json")
        if cell_format not in ("json", "text"):
            raise QueryValidationError("cell_format must be json or text")

        integration, client = service.get_client(slug, project_id)
        return Response(
            service.get_record(integration, client, base_id, table_id, record_id, cell_format),
            status=status.HTTP_200_OK,
        )
