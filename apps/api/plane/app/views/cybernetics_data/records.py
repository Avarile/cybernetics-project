# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work item <-> Cybernetics-Data record links.

Lets project members attach external database records to a work item. Each
attachment stores a reference (base/table/record/view ids) plus a snapshot
of the record, which can be refreshed later. Attach/remove actions are
recorded in the work item activity feed.
"""

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import CyberneticsRecordAttachSerializer, IssueCyberneticsRecordSerializer
from plane.app.views.base import BaseViewSet
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, IssueCyberneticsRecord, ProjectCyberneticsDataIntegration
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data import service
from plane.utils.cybernetics_data.client import CyberneticsForbidden, CyberneticsNotFound
from plane.utils.host import base_host
from .base import CyberneticsDataErrorMixin, error_response


class IssueCyberneticsRecordViewSet(CyberneticsDataErrorMixin, BaseViewSet):
    """Cybernetics-Data records attached to a work item (reference + snapshot)."""

    model = IssueCyberneticsRecord
    serializer_class = IssueCyberneticsRecordSerializer

    def get_throttles(self):
        """Throttle only POST actions (create/refresh), which call Cybernetics-Data."""
        # Only the actions that call Cybernetics-Data are throttled.
        if self.request.method == "POST":
            return [CyberneticsDataProxyThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        """Records of the URL's work item, limited to active members of non-archived projects."""
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )

    def _serializer_context(self, slug, project_id):
        """Serializer context carrying the integration ``base_url`` (used to build record links)."""
        integration = ProjectCyberneticsDataIntegration.objects.filter(
            workspace__slug=slug, project_id=project_id
        ).first()
        return {"base_url": integration.base_url if integration else None}

    def _get_editable_issue(self, slug, project_id, issue_id):
        """Fetch the work item, raising DoesNotExist if it or its project is archived."""
        return Issue.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            pk=issue_id,
            archived_at__isnull=True,
            project__archived_at__isnull=True,
        )

    def _log_activity(self, request, activity_type, issue_id, project_id, requested_data, current_instance=None):
        """Queue an ``issue_activity`` Celery task for an attach/remove event."""
        issue_activity.delay(
            type=activity_type,
            requested_data=json.dumps(requested_data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=(
                json.dumps(current_instance, cls=DjangoJSONEncoder) if current_instance is not None else None
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id, issue_id):
        """List records attached to the work item (any project role)."""
        serializer = IssueCyberneticsRecordSerializer(
            self.get_queryset(), many=True, context=self._serializer_context(slug, project_id)
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id, issue_id):
        """Attach one or more records to the work item.

        Duplicates (already attached or repeated in the payload) are skipped. All
        snapshots are fetched first; if any record is missing/forbidden nothing is
        saved and a 400 lists the failures. Returns ``{"created", "skipped"}``.
        """
        payload = CyberneticsRecordAttachSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        issue = self._get_editable_issue(slug, project_id, issue_id)
        integration, client = service.get_client(slug, project_id)

        existing = set(self.get_queryset().values_list("table_id", "record_id"))
        to_create, skipped, seen = [], [], set()
        for ref in payload.validated_data["records"]:
            key = (ref["table_id"], ref["record_id"])
            if key in existing or key in seen:
                skipped.append({"table_id": key[0], "record_id": key[1], "reason": "already_attached"})
                continue
            seen.add(key)
            to_create.append(ref)

        snapshots, failed = [], []
        for ref in to_create:
            try:
                snapshots.append(
                    service.build_snapshot(
                        integration, client, ref["base_id"], ref["table_id"], ref["record_id"], ref.get("view_id")
                    )
                )
            except (CyberneticsNotFound, CyberneticsForbidden) as exc:
                failed.append({"record_id": ref["record_id"], "table_id": ref["table_id"], "error_message": exc.code})
        if failed:
            return error_response(
                "CYBERNETICS_ATTACH_FAILED",
                "Some records could not be read from Cybernetics Data.",
                status.HTTP_400_BAD_REQUEST,
                failed=failed,
            )

        now = timezone.now()
        created = []
        # Each insert gets its own savepoint so a unique-constraint race skips just that row.
        with transaction.atomic():
            for snapshot in snapshots:
                try:
                    with transaction.atomic():
                        created.append(
                            IssueCyberneticsRecord.objects.create(
                                issue=issue, project_id=project_id, snapshot_at=now, status="ok", **snapshot
                            )
                        )
                except IntegrityError:
                    # Attached concurrently by another request.
                    skipped.append(
                        {
                            "table_id": snapshot["table_id"],
                            "record_id": snapshot["record_id"],
                            "reason": "already_attached",
                        }
                    )

        context = {"base_url": integration.base_url}
        data = IssueCyberneticsRecordSerializer(created, many=True, context=context).data
        for row in data:
            self._log_activity(request, "cybernetics_record.activity.created", issue_id, project_id, row)
        return Response({"created": data, "skipped": skipped}, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN], creator=True, model=IssueCyberneticsRecord)
    def destroy(self, request, slug, project_id, issue_id, pk):
        """Detach a record (project admin or the record's creator) and log the activity."""
        self._get_editable_issue(slug, project_id, issue_id)
        record = self.get_queryset().get(pk=pk)
        current = IssueCyberneticsRecordSerializer(record, context={"base_url": None}).data
        record.delete()
        self._log_activity(
            request,
            "cybernetics_record.activity.deleted",
            issue_id,
            project_id,
            {"id": str(pk)},
            current_instance=current,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def refresh(self, request, slug, project_id, issue_id):
        """Re-fetch snapshots for attached records (all, or the given ``ids``).

        Records that disappeared or became inaccessible are kept but flagged
        ``missing`` / ``forbidden``; at most ``MAX_RECORDS_PER_REQUEST`` are processed.
        """
        self._get_editable_issue(slug, project_id, issue_id)
        ids = request.data.get("ids") if isinstance(request.data, dict) else None
        queryset = self.get_queryset()
        if ids:
            if not isinstance(ids, list) or len(ids) > service.MAX_RECORDS_PER_REQUEST:
                return error_response(
                    "CYBERNETICS_BAD_REQUEST",
                    f"ids must be a list of at most {service.MAX_RECORDS_PER_REQUEST} ids",
                    status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(pk__in=ids)
        rows = list(queryset[: service.MAX_RECORDS_PER_REQUEST])
        integration, client = service.get_client(slug, project_id)

        now = timezone.now()
        for row in rows:
            try:
                snapshot = service.build_snapshot(
                    integration, client, row.base_id, row.table_id, row.record_id, row.view_id
                )
            except CyberneticsNotFound:
                row.status = "missing"
            except CyberneticsForbidden:
                row.status = "forbidden"
            else:
                for field, value in snapshot.items():
                    setattr(row, field, value)
                row.status = "ok"
            row.snapshot_at = now
            row.save()

        data = IssueCyberneticsRecordSerializer(
            self.get_queryset(), many=True, context={"base_url": integration.base_url}
        ).data
        return Response(data, status=status.HTTP_200_OK)
