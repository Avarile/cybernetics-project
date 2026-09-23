# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sign-out view for the web app (``POST /auth/sign-out/``)."""

# Django imports
from django.views import View
from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.utils import timezone

# Module imports
from plane.authentication.utils.host import user_ip, base_host
from plane.db.models import User


class SignOutAuthEndpoint(View):
    """Log the current user out of the web app."""

    def post(self, request):
        """Record logout IP/time, clear the session and redirect to the app; always redirects, even on error."""
        # Get user
        try:
            user = User.objects.get(pk=request.user.id)
            user.last_logout_ip = user_ip(request=request)
            user.last_logout_time = timezone.now()
            user.save()
            # Log the user out
            logout(request)
            return HttpResponseRedirect(base_host(request=request, is_app=True))
        except Exception:
            return HttpResponseRedirect(base_host(request=request, is_app=True))
