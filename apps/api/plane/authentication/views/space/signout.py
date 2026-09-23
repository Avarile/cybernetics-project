# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sign-out view for the space frontend (``POST /auth/spaces/sign-out/``)."""

# Django imports
from django.views import View
from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.utils import timezone

# Module imports
from plane.authentication.utils.host import base_host, user_ip
from plane.db.models import User
from plane.utils.path_validator import get_safe_redirect_url


class SignOutAuthSpaceEndpoint(View):
    """Log the current user out of the space frontend."""

    def post(self, request):
        """Record logout IP/time, clear the session and redirect to the space ``next_path``; always redirects."""
        next_path = request.POST.get("next_path")

        # Get user
        try:
            user = User.objects.get(pk=request.user.id)
            user.last_logout_ip = user_ip(request=request)
            user.last_logout_time = timezone.now()
            user.save()
            # Log the user out
            logout(request)
            url = get_safe_redirect_url(base_url=base_host(request=request, is_space=True), next_path=next_path)
            return HttpResponseRedirect(url)
        except Exception:
            url = get_safe_redirect_url(base_url=base_host(request=request, is_space=True), next_path=next_path)
            return HttpResponseRedirect(url)
