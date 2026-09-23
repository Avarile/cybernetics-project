# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace webhook management views.

Workspace admins can create, list, update and delete outgoing webhooks
(``WebhookEndpoint``), rotate a webhook's signing secret
(``WebhookSecretRegenerateEndpoint``) and inspect delivery logs
(``WebhookLogsEndpoint``).
"""

# Django imports
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import Webhook, WebhookLog, Workspace
from plane.db.models.webhook import generate_token
from ..base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import WebhookSerializer, WebhookLogSerializer


class WebhookEndpoint(BaseAPIView):
    """CRUD for a workspace's webhooks (workspace admins only)."""

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        """Create a webhook; a duplicate URL in the workspace returns 409."""
        workspace = Workspace.objects.get(slug=slug)
        try:
            serializer = WebhookSerializer(data=request.data, context={"request": request})
            if serializer.is_valid():
                serializer.save(workspace_id=workspace.id)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"error": "URL already exists for the workspace"},
                    status=status.HTTP_409_CONFLICT,
                )
            # Re-raise any other integrity error
            raise IntegrityError

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        """List all workspace webhooks, or return one when ``pk`` is given.

        The field list deliberately omits the secret key.
        """
        if pk is None:
            webhooks = Webhook.objects.filter(workspace__slug=slug)
            serializer = WebhookSerializer(
                webhooks,
                fields=(
                    "id",
                    "url",
                    "is_active",
                    "created_at",
                    "updated_at",
                    "project",
                    "issue",
                    "cycle",
                    "module",
                    "issue_comment",
                ),
                many=True,
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
            serializer = WebhookSerializer(
                webhook,
                fields=(
                    "id",
                    "url",
                    "is_active",
                    "created_at",
                    "updated_at",
                    "project",
                    "issue",
                    "cycle",
                    "module",
                    "issue_comment",
                ),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk):
        """Partially update a webhook (URL, active flag, subscribed events)."""
        webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
        serializer = WebhookSerializer(
            webhook,
            data=request.data,
            context={"request": request},
            partial=True,
            fields=(
                "id",
                "url",
                "is_active",
                "created_at",
                "updated_at",
                "project",
                "issue",
                "cycle",
                "module",
                "issue_comment",
            ),
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk):
        """Delete a webhook."""
        webhook = Webhook.objects.get(pk=pk, workspace__slug=slug)
        webhook.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebhookSecretRegenerateEndpoint(BaseAPIView):
    """Rotate a webhook's signing secret (workspace admins only)."""

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk):
        """Generate a new secret key and return the full webhook, including the new secret."""
        webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
        webhook.secret_key = generate_token()
        webhook.save()
        serializer = WebhookSerializer(webhook)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WebhookLogsEndpoint(BaseAPIView):
    """Delivery logs for a webhook (workspace admins only)."""

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, webhook_id):
        """Return all delivery log entries recorded for the webhook."""
        webhook_logs = WebhookLog.objects.filter(workspace__slug=slug, webhook=webhook_id)
        serializer = WebhookLogSerializer(webhook_logs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
