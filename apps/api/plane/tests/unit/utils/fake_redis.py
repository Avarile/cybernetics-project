# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Minimal in-memory stand-in for the redis-py calls the two-factor utils make (no TTL expiry)."""


class FakePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.calls = []

    def incr(self, key):
        self.calls.append(("incr", key))
        return self

    def expire(self, key, seconds):
        self.calls.append(("expire", key, seconds))
        return self

    def execute(self):
        return [getattr(self.redis, name)(*args) for name, *args in self.calls]


class FakeRedis:
    def __init__(self):
        self.store = {}
        self.ttls = {}

    def get(self, key):
        value = self.store.get(key)
        return value.encode() if isinstance(value, str) else value

    def set(self, key, value, ex=None):
        self.store[key] = value
        if ex is not None:
            self.ttls[key] = ex
        return True

    def exists(self, key):
        return int(key in self.store)

    def delete(self, *keys):
        removed = 0
        for key in keys:
            if key in self.store:
                removed += 1
                del self.store[key]
            self.ttls.pop(key, None)
        return removed

    def incr(self, key):
        self.store[key] = int(self.store.get(key, 0)) + 1
        return self.store[key]

    def expire(self, key, seconds):
        self.ttls[key] = seconds
        return key in self.store

    def pipeline(self):
        return FakePipeline(self)
