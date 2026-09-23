# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re
from pathlib import Path

import pytest
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers
from rest_framework.exceptions import Throttled
from rest_framework.test import APIRequestFactory

from plane.app.views.base import BaseAPIView
from plane.app.views.cybernetics_data.base import CyberneticsDataErrorMixin, error_response
from plane.utils.cybernetics_data import client as client_module
from plane.utils.cybernetics_data import service
from plane.utils.cybernetics_data.filters import QueryValidationError
from plane.utils.error_codes import ERROR_CODES


class _RaisingView(CyberneticsDataErrorMixin, BaseAPIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = []
    exc = None

    def get(self, request):
        raise self.exc


def _call(exc):
    request = APIRequestFactory().get("/api/cybernetics-test/")
    return _RaisingView.as_view(exc=exc)(request)


@pytest.mark.unit
class TestErrorMixin:
    @pytest.mark.parametrize(
        "exc_class,status_code,key",
        [
            (service.IntegrationNotConfigured, 404, "CYBERNETICS_NOT_CONFIGURED"),
            (service.TokenUnreadable, 409, "CYBERNETICS_TOKEN_UNREADABLE"),
            (client_module.CyberneticsUnauthorized, 424, "CYBERNETICS_UNAUTHORIZED"),
            (client_module.CyberneticsForbidden, 403, "CYBERNETICS_FORBIDDEN"),
            (client_module.CyberneticsNotFound, 404, "CYBERNETICS_NOT_FOUND"),
            (client_module.CyberneticsBadRequest, 400, "CYBERNETICS_BAD_REQUEST"),
            (client_module.CyberneticsRateLimited, 429, "CYBERNETICS_RATE_LIMITED"),
            (client_module.CyberneticsUnreachable, 502, "CYBERNETICS_UNREACHABLE"),
            (client_module.CyberneticsDataError, 502, "CYBERNETICS_ERROR"),
        ],
    )
    def test_cybernetics_errors(self, exc_class, status_code, key):
        response = _call(exc_class("human readable"))
        assert response.status_code == status_code
        assert response.data == {"error": "human readable", "error_code": ERROR_CODES[key], "error_message": key}

    def test_default_messages(self):
        assert _call(service.IntegrationNotConfigured()).data["error"] == (
            "Cybernetics Data is not configured for this project"
        )
        assert "enter it again" in _call(service.TokenUnreadable()).data["error"]

    def test_upstream_401_is_never_401(self):
        assert _call(client_module.CyberneticsUnauthorized("expired")).status_code == 424

    def test_throttled_with_wait(self):
        response = _call(Throttled(wait=12.7))
        assert response.status_code == 429
        assert response.data["error_message"] == "CYBERNETICS_RATE_LIMITED"
        assert response.data["error_code"] == ERROR_CODES["CYBERNETICS_RATE_LIMITED"]
        # DRF rounds ``wait`` up; the header carries whole seconds.
        assert response["Retry-After"] == "13"

    def test_throttled_without_wait(self):
        response = _call(Throttled())
        assert response.status_code == 429
        assert response.data["error_message"] == "CYBERNETICS_RATE_LIMITED"
        assert not response.has_header("Retry-After")

    def test_query_validation_error(self):
        response = _call(QueryValidationError("Invalid base id"))
        assert response.status_code == 400
        assert response.data == {
            "error": "Invalid base id",
            "error_code": ERROR_CODES["CYBERNETICS_BAD_REQUEST"],
            "error_message": "CYBERNETICS_BAD_REQUEST",
        }

    def test_object_does_not_exist_falls_through(self):
        response = _call(ObjectDoesNotExist())
        assert response.status_code == 404
        assert response.data == {"error": "The required object does not exist."}

    def test_drf_validation_error_falls_through(self):
        response = _call(serializers.ValidationError({"base_url": ["bad"]}))
        assert response.status_code == 400
        assert response.data == {"base_url": ["bad"]}

    def test_error_response_extra_fields(self):
        response = error_response("CYBERNETICS_ATTACH_FAILED", "Some failed", 400, failed=[{"record_id": "x"}])
        assert response.status_code == 400
        assert response.data == {
            "error": "Some failed",
            "error_code": 4811,
            "error_message": "CYBERNETICS_ATTACH_FAILED",
            "failed": [{"record_id": "x"}],
        }


def _all_subclasses(cls):
    for sub in cls.__subclasses__():
        yield sub
        yield from _all_subclasses(sub)


@pytest.mark.unit
class TestErrorCodes:
    def test_codes_block(self):
        cybernetics = {k: v for k, v in ERROR_CODES.items() if k.startswith("CYBERNETICS_")}
        assert cybernetics == {
            "CYBERNETICS_NOT_CONFIGURED": 4801,
            "CYBERNETICS_TOKEN_UNREADABLE": 4802,
            "CYBERNETICS_TOKEN_REQUIRED": 4803,
            "CYBERNETICS_UNAUTHORIZED": 4804,
            "CYBERNETICS_FORBIDDEN": 4805,
            "CYBERNETICS_NOT_FOUND": 4806,
            "CYBERNETICS_BAD_REQUEST": 4807,
            "CYBERNETICS_RATE_LIMITED": 4808,
            "CYBERNETICS_UNREACHABLE": 4809,
            "CYBERNETICS_VERIFICATION_FAILED": 4810,
            "CYBERNETICS_ATTACH_FAILED": 4811,
            "CYBERNETICS_ERROR": 4812,
        }

    def test_every_exception_code_is_registered(self):
        classes = [client_module.CyberneticsDataError, *_all_subclasses(client_module.CyberneticsDataError)]
        assert len(classes) >= 9
        for exc_class in classes:
            assert exc_class.code in ERROR_CODES, exc_class

    def test_every_code_used_in_source_is_registered(self):
        root = Path(client_module.__file__).resolve().parents[2]
        sources = [
            *(root / "utils" / "cybernetics_data").glob("*.py"),
            *(root / "app" / "views" / "cybernetics_data").glob("*.py"),
        ]
        used = set()
        for source in sources:
            used |= set(re.findall(r"[\"'](CYBERNETICS_[A-Z_]+)[\"']", source.read_text()))
        # Settings names are not error codes.
        used = {name for name in used if not name.startswith("CYBERNETICS_DATA_")}
        assert {"CYBERNETICS_TOKEN_REQUIRED", "CYBERNETICS_VERIFICATION_FAILED", "CYBERNETICS_ATTACH_FAILED"} <= used
        assert used - set(ERROR_CODES) == set()
