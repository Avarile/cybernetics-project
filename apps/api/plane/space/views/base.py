# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base view classes for the public (space) API.

Same shape as the app's base views: session auth, per-user timezone activation,
filter/pagination helpers and uniform JSON error handling. Public endpoints override
``permission_classes`` with ``AllowAny``.
"""

# Python imports
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
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.authentication.session import BaseSessionAuthentication


class TimezoneMixin:
    """
    This enables timezone conversion according
    to the user set timezone
    """

    def initial(self, request, *args, **kwargs):
        """Activate the user's timezone for this request (or reset to default for anonymous users)."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseViewSet(TimezoneMixin, ModelViewSet, BasePaginator):
    """Base ModelViewSet for space endpoints; requires authentication unless overridden."""

    model = None

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    def get_queryset(self):
        """Return all rows of ``self.model``; misconfigured views raise a 400 APIException."""
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
            # Map common Django/DB errors to 4xx responses; anything else is logged and returned as 500.
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
        """Run the view, converting uncaught exceptions to error responses; logs query count when DEBUG."""
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
        """Workspace slug from the URL kwargs, if any."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from URL kwargs, or ``pk`` on the route named "project"."""
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)


class BaseAPIView(TimezoneMixin, APIView, BasePaginator):
    """Base APIView for space endpoints; requires authentication unless overridden."""

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    filterset_fields = []

    search_fields = []

    authentication_classes = [BaseSessionAuthentication]

    def filter_queryset(self, queryset):
        """Apply every configured filter backend (DjangoFilter, search) to ``queryset``."""
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
            # Map common Django/DB errors to 4xx responses; anything else is logged and returned as 500.
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
        """Run the view, converting uncaught exceptions to error responses; logs query count when DEBUG."""
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
        """Workspace slug from the URL kwargs, if any."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Project id from the URL kwargs, if any."""
        return self.kwargs.get("project_id", None)
