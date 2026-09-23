# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import ipaddress
import logging

import pytest

from plane.settings.common import _parse_allowed_hosts, _parse_allowed_ips

ENV = "CYBERNETICS_DATA_TEST_ALLOWLIST"


@pytest.mark.unit
class TestParseAllowedIps:
    @pytest.mark.parametrize("value", [None, "", " , ,"])
    def test_empty(self, monkeypatch, value):
        if value is None:
            monkeypatch.delenv(ENV, raising=False)
        else:
            monkeypatch.setenv(ENV, value)
        assert _parse_allowed_ips(ENV) == []

    def test_cidrs_and_single_ips(self, monkeypatch):
        monkeypatch.setenv(ENV, "10.0.0.0/8, 192.168.1.5 ,fd00::/8,10.1.2.3/16")
        assert _parse_allowed_ips(ENV) == [
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("192.168.1.5/32"),
            ipaddress.ip_network("fd00::/8"),
            # strict=False: host bits are masked
            ipaddress.ip_network("10.1.0.0/16"),
        ]

    def test_invalid_entry_is_skipped_with_warning(self, monkeypatch, caplog):
        monkeypatch.setenv(ENV, "10.0.0.0/8,not-an-ip,999.1.1.1")
        # Django's LOGGING dictConfig disables the "plane" logger created while settings load.
        monkeypatch.setattr(logging.getLogger("plane"), "disabled", False)
        with caplog.at_level(logging.WARNING, logger="plane"):
            assert _parse_allowed_ips(ENV) == [ipaddress.ip_network("10.0.0.0/8")]
        messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
        assert any("not-an-ip" in m and ENV in m for m in messages)
        assert any("999.1.1.1" in m for m in messages)


@pytest.mark.unit
class TestParseAllowedHosts:
    def test_normalised(self, monkeypatch):
        monkeypatch.setenv(ENV, " Data.Example.COM. ,, internal.local ,  ,API.example.com..")
        assert _parse_allowed_hosts(ENV) == ["data.example.com", "internal.local", "api.example.com"]

    @pytest.mark.parametrize("value", [None, "", " , "])
    def test_empty(self, monkeypatch, value):
        if value is None:
            monkeypatch.delenv(ENV, raising=False)
        else:
            monkeypatch.setenv(ENV, value)
        assert _parse_allowed_hosts(ENV) == []

    @pytest.mark.xfail(
        reason="an entry made only of dots passes the emptiness check before the dots are stripped, "
        "so it ends up as an empty hostname in the list",
        strict=True,
    )
    def test_dot_only_entry_dropped(self, monkeypatch):
        monkeypatch.setenv(ENV, "data.example.com, .")
        assert _parse_allowed_hosts(ENV) == ["data.example.com"]
