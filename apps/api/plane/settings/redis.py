# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Helper for obtaining a raw redis-py client from ``settings.REDIS_URL`` (outside the Django cache API)."""

import redis
from django.conf import settings
from urllib.parse import urlparse


def redis_instance():
    """Return a new ``redis.Redis`` client for ``REDIS_URL``.

    For ``rediss://`` URLs it connects with TLS and no certificate verification; otherwise db 0 is used.
    """
    # connect to redis
    if settings.REDIS_SSL:
        url = urlparse(settings.REDIS_URL)
        ri = redis.Redis(
            host=url.hostname,
            port=url.port,
            password=url.password,
            ssl=True,
            ssl_cert_reqs=None,
        )
    else:
        ri = redis.Redis.from_url(settings.REDIS_URL, db=0)

    return ri
