# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``CyberneticsDataProxyThrottle`` (``plane.throttles.cybernetics_data``).

The throttle rate-limits proxied Cybernetics-Data calls per (user, project). The cache and
rate are patched so tests run without Redis.
"""

from types import SimpleNamespace

import pytest

from plane.tests.unit.cybernetics_data.fakes import DictCache
from plane.throttles.cybernetics_data import CyberneticsDataProxyThrottle


def _request(pk="user-1", authenticated=True):
    """Build a fake DRF request carrying only the attributes the throttle reads."""
    user = SimpleNamespace(pk=pk, is_authenticated=authenticated)
    return SimpleNamespace(user=user, META={})


def _view(project_id="project-1"):
    """Build a fake view whose URL kwargs carry the project id used in the cache key."""
    return SimpleNamespace(kwargs={"slug": "ws", "project_id": project_id})


@pytest.fixture
def cache(mocker):
    """Swap the throttle's cache for an in-memory ``DictCache`` and fix the rate to 2 requests/minute."""
    cache = DictCache()
    mocker.patch.object(CyberneticsDataProxyThrottle, "cache", cache)
    mocker.patch.object(CyberneticsDataProxyThrottle, "get_rate", return_value="2/min")
    return cache


@pytest.mark.unit
class TestCyberneticsDataProxyThrottle:
    """Cache-key scoping and allow/deny behaviour of the proxy throttle."""

    def test_scope(self):
        assert CyberneticsDataProxyThrottle.scope == "cybernetics_data"

    def test_anonymous_user_has_no_key(self, cache):
        """No cache key for anonymous/missing users, which disables throttling for them."""
        throttle = CyberneticsDataProxyThrottle()
        assert throttle.get_cache_key(_request(authenticated=False), _view()) is None
        assert throttle.get_cache_key(SimpleNamespace(user=None), _view()) is None

    def test_key_contains_scope_user_and_project(self, cache):
        key = CyberneticsDataProxyThrottle().get_cache_key(_request("user-1"), _view("project-1"))
        assert "cybernetics_data" in key
        assert "user-1" in key
        assert "project-1" in key

    def test_projects_have_separate_buckets(self, cache):
        throttle = CyberneticsDataProxyThrottle()
        assert throttle.get_cache_key(_request(), _view("project-1")) != throttle.get_cache_key(
            _request(), _view("project-2")
        )

    def test_users_have_separate_buckets(self, cache):
        throttle = CyberneticsDataProxyThrottle()
        assert throttle.get_cache_key(_request("user-1"), _view()) != throttle.get_cache_key(
            _request("user-2"), _view()
        )

    def test_third_request_is_throttled(self, cache):
        """With a 2/min rate the third call in the same bucket is denied."""
        request, view = _request(), _view()
        assert CyberneticsDataProxyThrottle().allow_request(request, view) is True
        assert CyberneticsDataProxyThrottle().allow_request(request, view) is True
        throttle = CyberneticsDataProxyThrottle()
        assert throttle.allow_request(request, view) is False
        assert 0 < throttle.wait() <= 60
        # Another project is not affected.
        assert CyberneticsDataProxyThrottle().allow_request(request, _view("project-2")) is True

    def test_anonymous_is_never_throttled(self, cache):
        for _ in range(5):
            assert CyberneticsDataProxyThrottle().allow_request(_request(authenticated=False), _view()) is True
