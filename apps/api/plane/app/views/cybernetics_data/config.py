# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    CyberneticsConnectionTestSerializer,
    ProjectCyberneticsDataIntegrationSerializer,
    ProjectCyberneticsDataIntegrationWriteSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import ProjectCyberneticsDataIntegration, ProjectMember
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle
from plane.utils.cybernetics_data.client import CyberneticsDataClient
from plane.utils.cybernetics_data.secrets import (
    TokenDecryptionError,
    decrypt_token,
    encrypt_token,
    token_fingerprint,
    token_hint,
)
from plane.utils.cybernetics_data.service import TokenUnreadable, verify_connection
from .base import CyberneticsDataErrorMixin, error_response

# Verification outcomes that block saving new connection details.
_BLOCKING_STATUSES = {"unauthorized", "unreachable", "error"}


def _stored_token(integration):
    try:
        return decrypt_token(integration.api_token_encrypted)
    except TokenDecryptionError:
        raise TokenUnreadable()


def _record_verification(integration, result):
    integration.last_verified_at = timezone.now()
    integration.last_verified_status = result["status"]
    integration.last_verified_message = result["message"][:1000]


class ProjectCyberneticsDataEndpoint(CyberneticsDataErrorMixin, BaseAPIView):
    """Read / save / disconnect the project's Cybernetics-Data connection."""

    def get_throttles(self):
        # Saving may verify the connection upstream.
        if self.request.method == "PUT":
            return [CyberneticsDataProxyThrottle()]
        return super().get_throttles()

    def _get_integration(self, slug, project_id):
        return ProjectCyberneticsDataIntegration.objects.filter(workspace__slug=slug, project_id=project_id).first()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        integration = self._get_integration(slug, project_id)
        if integration is None:
            return Response({"is_configured": False}, status=status.HTTP_200_OK)
        is_guest = ProjectMember.objects.filter(
            member=request.user, project_id=project_id, is_active=True, role=ROLE.GUEST.value
        ).exists()
        if is_guest:
            # Guests only need to know whether the widget should render.
            return Response({"is_configured": True, "is_enabled": integration.is_enabled}, status=status.HTTP_200_OK)
        return Response(ProjectCyberneticsDataIntegrationSerializer(integration).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def put(self, request, slug, project_id):
        serializer = ProjectCyberneticsDataIntegrationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        integration = self._get_integration(slug, project_id)
        new_token = data.get("api_token") or ""

        if integration is None and (not data.get("base_url") or not new_token):
            return error_response(
                "CYBERNETICS_BAD_REQUEST", "Both the URL and the API token are required.", status.HTTP_400_BAD_REQUEST
            )

        base_url = data.get("base_url") or integration.base_url
        url_changed = integration is not None and base_url != integration.base_url
        if url_changed and not new_token:
            # Never send the stored token to a host it wasn't configured for.
            return error_response(
                "CYBERNETICS_TOKEN_REQUIRED",
                "Enter the API token again when changing the URL.",
                status.HTTP_400_BAD_REQUEST,
            )
        connection_changed = integration is None or bool(new_token) or url_changed

        result = None
        if connection_changed and not data.get("skip_verification"):
            result = verify_connection(CyberneticsDataClient(base_url, new_token))
            if result["status"] in _BLOCKING_STATUSES:
                return error_response(
                    "CYBERNETICS_VERIFICATION_FAILED",
                    result["message"] or "Could not verify the connection.",
                    status.HTTP_400_BAD_REQUEST,
                    verification=result,
                )

        if integration is None:
            integration = ProjectCyberneticsDataIntegration(project_id=project_id)
        integration.base_url = base_url
        if new_token:
            integration.api_token_encrypted = encrypt_token(new_token)
            integration.token_hint = token_hint(new_token)
            integration.token_fingerprint = token_fingerprint(new_token)
        if "is_enabled" in data:
            integration.is_enabled = data["is_enabled"]
        if result is not None:
            _record_verification(integration, result)
        elif connection_changed:
            integration.last_verified_at = None
            integration.last_verified_status = ""
            integration.last_verified_message = ""
        integration.save()

        return Response(ProjectCyberneticsDataIntegrationSerializer(integration).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id):
        integration = self._get_integration(slug, project_id)
        if integration is not None:
            # Soft-deleted rows are kept, so purge the secret before deleting.
            integration.api_token_encrypted = ""
            integration.token_hint = ""
            integration.token_fingerprint = ""
            integration.save(update_fields=["api_token_encrypted", "token_hint", "token_fingerprint"])
            integration.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectCyberneticsDataTestEndpoint(CyberneticsDataErrorMixin, BaseAPIView):
    """Verify a URL/token pair; missing values fall back to the stored ones."""

    throttle_classes = [CyberneticsDataProxyThrottle]

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        serializer = CyberneticsConnectionTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        integration = ProjectCyberneticsDataIntegration.objects.filter(
            workspace__slug=slug, project_id=project_id
        ).first()

        base_url = data.get("base_url") or (integration.base_url if integration else "")
        token = data.get("api_token") or ""
        if not token and integration is not None and base_url == integration.base_url:
            # The stored token is only ever sent to the URL it was saved with.
            token = _stored_token(integration)
        if not base_url or not token:
            return error_response(
                "CYBERNETICS_BAD_REQUEST", "Both the URL and the API token are required.", status.HTTP_400_BAD_REQUEST
            )

        result = verify_connection(CyberneticsDataClient(base_url, token))
        uses_stored = integration is not None and base_url == integration.base_url and not data.get("api_token")
        if uses_stored:
            _record_verification(integration, result)
            integration.save(update_fields=["last_verified_at", "last_verified_status", "last_verified_message"])
        return Response(result, status=status.HTTP_200_OK)
