# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.app.serializers.cybernetics_data``.

Covers the SSRF-aware base-URL validator, the integration read/write serializers (the API
token is write-only and never echoed back), record reference/attach payloads, and the
issue-record serializer's deep link. DNS is mocked; models are built in memory, not saved.
"""

import ipaddress
import socket
from uuid import uuid4

import pytest
from rest_framework import serializers

from plane.app.serializers.cybernetics_data import (
    CyberneticsConnectionTestSerializer,
    CyberneticsRecordAttachSerializer,
    CyberneticsRecordRefSerializer,
    IssueCyberneticsRecordSerializer,
    ProjectCyberneticsDataIntegrationSerializer,
    ProjectCyberneticsDataIntegrationWriteSerializer,
    validate_cybernetics_base_url,
)
from plane.db.models import IssueCyberneticsRecord, ProjectCyberneticsDataIntegration

# DNS lookup used by the URL validator's private-IP check; patched to control resolution.
GETADDRINFO = "plane.utils.ip_address.socket.getaddrinfo"
REF = {"base_id": "bseAAAAAAAA", "table_id": "tblAAAAAAAA", "record_id": "recAAAAAAAA"}


def _addrinfo(ip):
    """Fake ``getaddrinfo`` result resolving to a single IPv4 address."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))]


@pytest.fixture
def allowlisted(settings):
    """Allowlist ``data.example.com`` by hostname (no IP allowlist)."""
    settings.CYBERNETICS_DATA_ALLOWED_HOSTS = ["data.example.com"]
    settings.CYBERNETICS_DATA_ALLOWED_IPS = []
    return settings


@pytest.mark.unit
class TestUrlValidator:
    """``validate_cybernetics_base_url``: normalisation plus SSRF protection."""

    def test_normalises(self, allowlisted):
        assert validate_cybernetics_base_url(" https://data.example.com/api/ ") == "https://data.example.com"

    def test_allowlisted_host_skips_dns(self, allowlisted, mocker):
        """Allowlisted hosts (case-insensitive) are accepted without a DNS lookup."""
        lookup = mocker.patch(GETADDRINFO, side_effect=AssertionError("DNS must not be used"))
        assert validate_cybernetics_base_url("https://DATA.example.com") == "https://DATA.example.com"
        lookup.assert_not_called()

    def test_allowed_ips_permit_private_ip(self, settings, mocker):
        settings.CYBERNETICS_DATA_ALLOWED_HOSTS = []
        settings.CYBERNETICS_DATA_ALLOWED_IPS = [ipaddress.ip_network("10.0.0.0/8")]
        mocker.patch(GETADDRINFO, return_value=_addrinfo("10.1.2.3"))
        assert validate_cybernetics_base_url("https://internal.example.com") == "https://internal.example.com"

    @pytest.mark.parametrize("ip", ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.10"])
    def test_private_ip_rejected(self, settings, mocker, ip):
        """Hosts resolving to private, loopback or link-local (cloud metadata) IPs are rejected."""
        settings.CYBERNETICS_DATA_ALLOWED_HOSTS = []
        settings.CYBERNETICS_DATA_ALLOWED_IPS = []
        mocker.patch(GETADDRINFO, return_value=_addrinfo(ip))
        with pytest.raises(serializers.ValidationError) as info:
            validate_cybernetics_base_url("https://internal.example.com")
        assert str(info.value.detail[0]).startswith("Invalid or disallowed URL.")

    def test_public_ip_accepted(self, settings, mocker):
        settings.CYBERNETICS_DATA_ALLOWED_HOSTS = []
        mocker.patch(GETADDRINFO, return_value=_addrinfo("93.184.216.34"))
        assert validate_cybernetics_base_url("https://public.example.com") == "https://public.example.com"

    @pytest.mark.parametrize("value", ["ftp://data.example.com", "https://u:p@data.example.com", "not a url"])
    def test_malformed(self, allowlisted, value):
        with pytest.raises(serializers.ValidationError, match="Invalid or disallowed URL."):
            validate_cybernetics_base_url(value)


@pytest.mark.unit
class TestWriteSerializer:
    """Create/update payload for a project's integration settings."""

    def test_defaults(self, allowlisted):
        serializer = ProjectCyberneticsDataIntegrationWriteSerializer(data={})
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data == {"skip_verification": False}

    def test_full_payload(self, allowlisted):
        serializer = ProjectCyberneticsDataIntegrationWriteSerializer(
            data={
                "base_url": "https://data.example.com/api",
                "api_token": "  tok  ",
                "is_enabled": False,
                "skip_verification": True,
            }
        )
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data == {
            "base_url": "https://data.example.com",
            "api_token": "tok",
            "is_enabled": False,
            "skip_verification": True,
        }

    def test_blank_token_allowed(self, allowlisted):
        """A whitespace-only token is valid and stripped to an empty string."""
        serializer = ProjectCyberneticsDataIntegrationWriteSerializer(data={"api_token": "   "})
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["api_token"] == ""

    def test_length_limits(self, allowlisted):
        """``api_token`` is capped at 1024 chars and ``base_url`` rejects overly long URLs."""
        ok = ProjectCyberneticsDataIntegrationWriteSerializer(data={"api_token": "t" * 1024})
        assert ok.is_valid(), ok.errors
        too_long = ProjectCyberneticsDataIntegrationWriteSerializer(data={"api_token": "t" * 1025})
        assert not too_long.is_valid()
        assert "api_token" in too_long.errors
        url = "https://data.example.com/" + "p" * 2048
        long_url = ProjectCyberneticsDataIntegrationWriteSerializer(data={"base_url": url})
        assert not long_url.is_valid()
        assert "base_url" in long_url.errors

    def test_token_is_write_only(self):
        assert ProjectCyberneticsDataIntegrationWriteSerializer().fields["api_token"].write_only is True

    def test_invalid_url_is_a_field_error(self, allowlisted):
        serializer = ProjectCyberneticsDataIntegrationWriteSerializer(data={"base_url": "ftp://data.example.com"})
        assert not serializer.is_valid()
        assert str(serializer.errors["base_url"][0]).startswith("Invalid or disallowed URL.")


@pytest.mark.unit
class TestConnectionTestSerializer:
    """Payload for the "test connection" endpoint; both fields are optional."""

    def test_blank_url_passes_through(self, mocker):
        """A blank URL skips validation (and DNS) entirely."""
        lookup = mocker.patch(GETADDRINFO)
        serializer = CyberneticsConnectionTestSerializer(data={"base_url": "", "api_token": ""})
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data == {"base_url": "", "api_token": ""}
        lookup.assert_not_called()

    def test_url_is_validated(self, allowlisted):
        serializer = CyberneticsConnectionTestSerializer(data={"base_url": "https://data.example.com/api/"})
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data["base_url"] == "https://data.example.com"


@pytest.mark.unit
class TestRecordRefSerializer:
    """Reference to a single Teable record (base/table/record, optional view)."""

    def test_valid(self):
        serializer = CyberneticsRecordRefSerializer(data=REF)
        assert serializer.is_valid(), serializer.errors
        assert serializer.validated_data == {**REF, "view_id": ""}

    @pytest.mark.parametrize(
        "field,value",
        [("base_id", "tblAAAAAAAA"), ("table_id", "bseAAAAAAAA"), ("record_id", "rec../../x"), ("view_id", "viw")],
    )
    def test_each_id_kind_is_checked(self, field, value):
        """Each id must carry its own kind prefix; errors surface as ``non_field_errors``."""
        serializer = CyberneticsRecordRefSerializer(data={**REF, field: value})
        assert not serializer.is_valid()
        assert "non_field_errors" in serializer.errors

    def test_view_id(self):
        blank = CyberneticsRecordRefSerializer(data={**REF, "view_id": ""})
        assert blank.is_valid(), blank.errors
        valid = CyberneticsRecordRefSerializer(data={**REF, "view_id": "viwAAAAAAAA"})
        assert valid.is_valid(), valid.errors
        assert valid.validated_data["view_id"] == "viwAAAAAAAA"

    def test_missing_field(self):
        serializer = CyberneticsRecordRefSerializer(data={"base_id": "bseAAAAAAAA"})
        assert not serializer.is_valid()
        assert {"table_id", "record_id"} <= set(serializer.errors)


@pytest.mark.unit
class TestAttachSerializer:
    """Bulk attach payload: 1-10 record references per request."""

    def _refs(self, count):
        """Build ``count`` distinct record references."""
        return [{**REF, "record_id": f"rec{i:08d}"} for i in range(count)]

    def test_empty_rejected(self):
        assert not CyberneticsRecordAttachSerializer(data={"records": []}).is_valid()
        assert not CyberneticsRecordAttachSerializer(data={}).is_valid()

    def test_ten_accepted(self):
        serializer = CyberneticsRecordAttachSerializer(data={"records": self._refs(10)})
        assert serializer.is_valid(), serializer.errors
        assert len(serializer.validated_data["records"]) == 10

    def test_eleven_rejected(self):
        serializer = CyberneticsRecordAttachSerializer(data={"records": self._refs(11)})
        assert not serializer.is_valid()
        assert "records" in serializer.errors


@pytest.mark.unit
class TestReadSerializer:
    """Integration read serializer must expose status fields but never token material."""

    def test_fields_and_no_token(self):
        integration = ProjectCyberneticsDataIntegration(
            id=uuid4(),
            project_id=uuid4(),
            base_url="https://data.example.com",
            api_token_encrypted="ENCRYPTED",
            token_hint="cybe…1a2b",
            token_fingerprint="f" * 64,
            last_verified_status="ok",
        )
        data = ProjectCyberneticsDataIntegrationSerializer(integration).data
        assert set(data) == {
            "id",
            "project",
            "is_configured",
            "is_enabled",
            "base_url",
            "token_hint",
            "last_verified_at",
            "last_verified_status",
            "last_verified_message",
            "updated_at",
            "updated_by",
        }
        assert data["is_configured"] is True
        assert data["is_enabled"] is True
        assert data["token_hint"] == "cybe…1a2b"
        assert "ENCRYPTED" not in str(data)
        assert "f" * 64 not in str(data)


@pytest.mark.unit
class TestRecordSerializer:
    """``IssueCyberneticsRecordSerializer`` output fields and deep-link construction."""

    def _record(self):
        """Unsaved ``IssueCyberneticsRecord`` with a stale ``source_url`` host."""
        return IssueCyberneticsRecord(
            id=uuid4(),
            issue_id=uuid4(),
            project_id=uuid4(),
            base_id="bseAAAAAAAA",
            table_id="tblAAAAAAAA",
            record_id="recAAAAAAAA",
            source_url="https://old.example.com/base/bseAAAAAAAA/table/tblAAAAAAAA?recordId=recAAAAAAAA",
        )

    def test_deep_link_uses_context_base_url(self):
        """The deep link is rebuilt from the integration's current ``base_url`` in context."""
        data = IssueCyberneticsRecordSerializer(self._record(), context={"base_url": "https://new.example.com"}).data
        assert data["deep_link"] == "https://new.example.com/base/bseAAAAAAAA/table/tblAAAAAAAA?recordId=recAAAAAAAA"

    @pytest.mark.parametrize("context", [{}, {"base_url": None}, {"base_url": ""}])
    def test_deep_link_falls_back_to_source_url(self, context):
        record = self._record()
        data = IssueCyberneticsRecordSerializer(record, context=context).data
        assert data["deep_link"] == record.source_url

    def test_fields(self):
        data = IssueCyberneticsRecordSerializer(self._record()).data
        assert set(data) == {
            "id",
            "issue_id",
            "project_id",
            "space_id",
            "base_id",
            "base_name",
            "table_id",
            "table_name",
            "record_id",
            "record_name",
            "view_id",
            "preview",
            "source_url",
            "deep_link",
            "snapshot_at",
            "status",
            "created_by",
            "created_at",
        }
        assert data["status"] == "ok"
        assert data["preview"] == {}
