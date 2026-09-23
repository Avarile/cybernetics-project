# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base classes for public API (v1) views.

Provides API-key authentication, per-key throttling, user-timezone activation,
pagination, read-replica control, uniform JSON error handling and helpers for
the ``fields`` / ``expand`` query parameters.
"""

# Python imports
import zoneinfo
import logging

# Django imports
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError
from django.urls import resolve
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.exceptions import APIException
from rest_framework.generics import GenericAPIView

# Module imports
from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.rate_limit import ApiKeyRateThrottle
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.utils.core.mixins import ReadReplicaControlMixin


logger = logging.getLogger("plane.api")


class TimezoneMixin:
    """
    This enables timezone conversion according
    to the user set timezone
    """

    def initial(self, request, *args, **kwargs):
        """Activate the authenticated user's timezone for the duration of the request."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseAPIView(TimezoneMixin, GenericAPIView, ReadReplicaControlMixin, BasePaginator):
    """Base APIView for public API endpoints (API-key auth, throttled, paginated)."""
    authentication_classes = [APIKeyAuthentication]

    permission_classes = [IsAuthenticated]

    use_read_replica = False

    def filter_queryset(self, queryset):
        """Apply every configured filter backend to the queryset."""
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def get_throttles(self):
        """Throttle every endpoint per API key."""
        return [ApiKeyRateThrottle()]

    def handle_exception(self, exc):
        """
        Handle any exception that occurs, by returning an appropriate response,
        or re-raising the error.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            # Map common unhandled exceptions to 4xx responses; anything else is logged as 500.
            if isinstance(e, IntegrityError):
                return Response(
                    {"error": "The payload is not valid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ValidationError):
                return Response(
                    {"error": "Please provide valid detail"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ObjectDoesNotExist):
                return Response(
                    {"error": "The requested resource does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                return Response(
                    {"error": "The required key does not exist."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            log_exception(e)
            return Response(
                {"error": "Something went wrong please try again later"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def dispatch(self, request, *args, **kwargs):
        """Dispatch the request, converting uncaught exceptions to JSON error responses.

        In DEBUG mode, prints the number of SQL queries executed for the request.
        """
        try:
            response = super().dispatch(request, *args, **kwargs)
            if settings.DEBUG:
                from django.db import connection

                print(f"{request.method} - {request.get_full_path()} of Queries: {len(connection.queries)}")
            return response
        except Exception as exc:
            response = self.handle_exception(exc)
            return response

    def finalize_response(self, request, response, *args, **kwargs):
        """Copy rate-limit info stashed by ApiKeyRateThrottle into response headers."""
        # Call super to get the default response
        response = super().finalize_response(request, response, *args, **kwargs)

        # Add custom headers if they exist in the request META
        ratelimit_remaining = request.META.get("X-RateLimit-Remaining")
        if ratelimit_remaining is not None:
            response["X-RateLimit-Remaining"] = ratelimit_remaining

        ratelimit_reset = request.META.get("X-RateLimit-Reset")
        if ratelimit_reset is not None:
            response["X-RateLimit-Reset"] = ratelimit_reset

        return response

    @property
    def workspace_slug(self):
        """Workspace slug from the URL kwargs."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from the URL; falls back to ``pk`` on the ``project`` detail route."""
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Comma-separated ``?fields=`` query param as a list, or None."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Comma-separated ``?expand=`` query param as a list, or None."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None


class BaseViewSet(TimezoneMixin, ReadReplicaControlMixin, ModelViewSet, BasePaginator):
    """Base ModelViewSet for public API viewsets (API-key auth, uniform error handling)."""
    model = None

    authentication_classes = [APIKeyAuthentication]
    permission_classes = [
        IsAuthenticated,
    ]
    use_read_replica = False

    def get_queryset(self):
        """Default queryset: all rows of ``self.model``."""
        try:
            return self.model.objects.all()
        except Exception as e:
            log_exception(e)
            raise APIException("Please check the view", status.HTTP_400_BAD_REQUEST)

    def handle_exception(self, exc):
        """
        Handle any exception that occurs, by returning an appropriate response,
        or re-raising the error.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            # Map common unhandled exceptions to 4xx responses; anything else is logged as 500.
            if isinstance(e, IntegrityError):
                log_exception(e)
                return Response(
                    {"error": "The payload is not valid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ValidationError):
                logger.warning(
                    "Validation Error",
                    extra={
                        "error_code": "VALIDATION_ERROR",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "Please provide valid detail"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ObjectDoesNotExist):
                logger.warning(
                    "Object Does Not Exist",
                    extra={
                        "error_code": "OBJECT_DOES_NOT_EXIST",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "The required object does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                logger.error(
                    "Key Error",
                    extra={
                        "error_code": "KEY_ERROR",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "The required key does not exist."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            log_exception(e)
            return Response(
                {"error": "Something went wrong please try again later"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def dispatch(self, request, *args, **kwargs):
        """Dispatch the request, converting uncaught exceptions to JSON error responses."""
        try:
            response = super().dispatch(request, *args, **kwargs)

            if settings.DEBUG:
                from django.db import connection

                print(f"{request.method} - {request.get_full_path()} of Queries: {len(connection.queries)}")

            return response
        except Exception as exc:
            response = self.handle_exception(exc)
            return response

    @property
    def workspace_slug(self):
        """Workspace slug from the URL kwargs."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from the URL; falls back to ``pk`` on the ``project`` detail route."""
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Comma-separated ``?fields=`` query param as a list, or None."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Comma-separated ``?expand=`` query param as a list, or None."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None
