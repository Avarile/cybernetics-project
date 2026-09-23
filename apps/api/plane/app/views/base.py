# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base classes shared by all ``plane.app`` (web app) API views.

``BaseViewSet`` and ``BaseAPIView`` wire in session authentication, the
authenticated-user permission default, filtering/search backends, cursor
pagination (``BasePaginator``), read-replica routing and per-user timezone
activation, and translate common exceptions into JSON error responses.
"""

# Python imports
import traceback

import zoneinfo
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError

# Django imports
from django.urls import resolve
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend

# Third part imports
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

# Module imports
from plane.authentication.session import BaseSessionAuthentication
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.utils.core.mixins import ReadReplicaControlMixin


class TimezoneMixin:
    """
    This enables timezone conversion according
    to the user set timezone
    """

    def initial(self, request, *args, **kwargs):
        """Activate the authenticated user's timezone for this request (UTC default otherwise)."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseViewSet(TimezoneMixin, ReadReplicaControlMixin, ModelViewSet, BasePaginator):
    """Base ``ModelViewSet`` for app endpoints; subclasses set ``model`` and serializers."""

    model = None

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    use_read_replica = False

    def get_queryset(self):
        """Default queryset: every row of ``self.model``; misconfigured views raise a 400."""
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
            # Unhandled by DRF: map well-known Django errors to 4xx, everything else to 500.
            (print(e, traceback.format_exc()) if settings.DEBUG else print("Server Error"))
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
                    {"error": "The required object does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                log_exception(e)
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
        """Run the view, logging the SQL query count in DEBUG, and convert any error into a response."""
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
        """Workspace slug from the URL kwargs, if present."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from the URL kwargs (or ``pk`` on the ``project`` detail route)."""
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Comma separated ``?fields=`` query param as a list, or None."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Comma separated ``?expand=`` query param as a list, or None."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None


class BaseAPIView(TimezoneMixin, ReadReplicaControlMixin, APIView, BasePaginator):
    """Base ``APIView`` for non-model endpoints; same auth, pagination and error handling as ``BaseViewSet``."""

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    use_read_replica = False

    def filter_queryset(self, queryset):
        """Apply the configured filter backends (django-filter + search) to ``queryset``."""
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def handle_exception(self, exc):
        """
        Handle any exception that occurs, by returning an appropriate response,
        or re-raising the error.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            # Unhandled by DRF: map well-known Django errors to 4xx, everything else to 500.
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
                    {"error": "The required object does not exist."},
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
        """Run the view, logging the SQL query count in DEBUG, and convert any error into a response."""
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
        """Workspace slug from the URL kwargs, if present."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from the URL kwargs, if present."""
        return self.kwargs.get("project_id", None)

    @property
    def fields(self):
        """Comma separated ``?fields=`` query param as a list, or None."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Comma separated ``?expand=`` query param as a list, or None."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None
