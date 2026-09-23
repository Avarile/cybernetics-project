# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Per-user response caching for DRF views, backed by the Django cache.

cache_response caches successful GET responses; invalidate_cache / invalidate_cache_directly
delete those entries when data changes.
"""

# Python imports
from functools import wraps

# Django imports
from django.conf import settings
from django.core.cache import cache

# Third party imports
from rest_framework.response import Response


def generate_cache_key(custom_path, auth_header=None):
    """Generate a cache key with the given params"""
    if auth_header:
        key_data = f"{custom_path}:{auth_header}"
    else:
        key_data = custom_path
    return key_data


def cache_response(timeout=60 * 60, path=None, user=True):
    """Decorator that caches a view method's 200 responses for `timeout` seconds.

    The key is `path` (or the full request path) plus the user id when user=True.
    Cached entries are replayed as a new Response; caching is skipped in DEBUG mode.
    """

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # Function to generate cache key
            auth_header = None if request.user.is_anonymous else str(request.user.id) if user else None
            custom_path = path if path is not None else request.get_full_path()
            key = generate_cache_key(custom_path, auth_header)
            cached_result = cache.get(key)

            if cached_result is not None:
                return Response(cached_result["data"], status=cached_result["status"])
            response = view_func(instance, request, *args, **kwargs)
            if response.status_code == 200 and not settings.DEBUG:
                cache.set(
                    key,
                    {"data": response.data, "status": response.status_code},
                    timeout,
                )

            return response

        return _wrapped_view

    return decorator


def invalidate_cache_directly(path=None, url_params=False, user=True, request=None, multiple=False):
    """Delete cached responses matching the key cache_response would have built.

    url_params=True substitutes ":name" placeholders in `path` with the resolved URL kwargs.
    multiple=True deletes every key containing the computed key (pattern match via cache.keys).
    """
    if url_params and path:
        path_with_values = path
        # Assuming `kwargs` could be passed directly if needed, otherwise, skip this part
        for key, value in request.resolver_match.kwargs.items():
            path_with_values = path_with_values.replace(f":{key}", str(value))
        custom_path = path_with_values
    else:
        custom_path = path if path is not None else request.get_full_path()
    auth_header = None if request and request.user.is_anonymous else str(request.user.id) if user else None
    key = generate_cache_key(custom_path, auth_header)

    if multiple:
        cache.delete_many(keys=cache.keys(f"*{key}*"))
    else:
        cache.delete(key)


def invalidate_cache(path=None, url_params=False, user=True, multiple=False):
    """Decorator that invalidates cached responses before running the wrapped view method."""
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # invalidate the cache
            invalidate_cache_directly(
                path=path,
                url_params=url_params,
                user=user,
                request=request,
                multiple=multiple,
            )
            return view_func(instance, request, *args, **kwargs)

        return _wrapped_view

    return decorator
