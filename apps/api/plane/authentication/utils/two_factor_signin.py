# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The sign-in half of email two-factor authentication.

After a correct password, ``start_challenge`` emails a code and keeps the
challenge token in the (not yet authenticated) Django session, so the token
never appears in a URL and only works from the browser that entered the
password. ``complete_challenge`` checks the code and returns the user to log in.

Each challenge carries an ``audience`` ("app" or "admin"). The admin console uses
its own session cookie, and a challenge started for one audience is refused by
the other, so an app challenge can never produce an admin session.
"""

# Python imports
import os
import time

# Module imports
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.authentication.utils import two_factor_lockout, verification_code
from plane.authentication.utils.host import base_host
from plane.authentication.utils.request_meta import get_request_meta
from plane.bgtasks.two_factor_email_task import two_factor_code_email
from plane.db.models import User
from plane.license.utils.instance_value import get_configuration_value

SESSION_KEY = "two_factor_challenge"
AUDIENCES = ("app", "admin")
RESEND_COOLDOWN_SECONDS = int(os.environ.get("TWO_FACTOR_RESEND_COOLDOWN", 30))
MAX_RESENDS = int(os.environ.get("TWO_FACTOR_MAX_RESENDS", 3))


def smtp_configured():
    """True when the instance can send email (same check as the instance config's ``is_smtp_configured``)."""
    (EMAIL_HOST,) = get_configuration_value([{"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")}])
    return bool(EMAIL_HOST)


def _error(name, payload=None):
    return AuthenticationException(
        error_code=AUTHENTICATION_ERROR_CODES[name],
        error_message=name,
        payload=payload or {},
    )


def start_challenge(request, user, audience, next_path=None, resends=0):
    """Email a sign-in code to ``user`` and remember the challenge in the session.

    Returns the TWO_FACTOR_REQUIRED error whose dict the sign-in view puts in its redirect.
    Raises SMTP_NOT_CONFIGURED when no code can be sent.
    """
    if not smtp_configured():
        raise _error("SMTP_NOT_CONFIGURED", {"email": user.email})
    # one live challenge per browser: signing in again replaces the earlier one
    verification_code.revoke(verification_code.PURPOSE_SIGNIN, request.session.get(SESSION_KEY))
    token, code, _ = verification_code.issue(
        verification_code.PURPOSE_SIGNIN,
        {
            "user_id": str(user.id),
            "email": user.email,
            "audience": audience,
            "next_path": next_path or "",
            "resends": resends,
            "sent_at": time.time(),
        },
    )
    request.session[SESSION_KEY] = token
    two_factor_code_email.delay(
        user.email,
        code,
        "admin_signin" if audience == "admin" else "signin",
        get_request_meta(request, user),
        base_host(request=request, is_app=True),
    )
    return _error("TWO_FACTOR_REQUIRED", {"email": user.email})


def _load_challenge(request, audience):
    token = request.session.get(SESSION_KEY)
    data = verification_code.peek(verification_code.PURPOSE_SIGNIN, token)
    if not data or data.get("audience") != audience:
        raise _error("EXPIRED_TWO_FACTOR_CODE")
    return token, data


def complete_challenge(request, audience, code):
    """Check ``code`` against the session's challenge and return ``(user, challenge_data)``.

    Wrong codes count toward the per-user lockout. Raises INVALID_TWO_FACTOR_CODE
    (the challenge stays usable), EXPIRED_TWO_FACTOR_CODE, TWO_FACTOR_ATTEMPTS_EXHAUSTED
    or TWO_FACTOR_LOCKED; error payloads carry the email so the sign-in page can refill it.
    """
    token, data = _load_challenge(request, audience)
    user_id, email = data["user_id"], data["email"]
    try:
        two_factor_lockout.assert_not_locked(user_id)
        try:
            verification_code.verify(verification_code.PURPOSE_SIGNIN, token, code)
        except AuthenticationException as e:
            if e.error_message in ("INVALID_TWO_FACTOR_CODE", "TWO_FACTOR_ATTEMPTS_EXHAUSTED"):
                two_factor_lockout.record_failure(user_id)
            raise
    except AuthenticationException as e:
        if e.error_message != "INVALID_TWO_FACTOR_CODE":
            # the challenge is gone or blocked: the user has to start over with the password
            request.session.pop(SESSION_KEY, None)
            verification_code.revoke(verification_code.PURPOSE_SIGNIN, token)
        e.payload = {**e.payload, "email": email}
        raise

    two_factor_lockout.clear_failures(user_id)
    request.session.pop(SESSION_KEY, None)
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        raise _error("EXPIRED_TWO_FACTOR_CODE", {"email": email})
    return user, data


def resend_challenge(request, audience):
    """Replace the session's challenge with a new code, at most MAX_RESENDS times and not within the cooldown."""
    token, data = _load_challenge(request, audience)
    wait = RESEND_COOLDOWN_SECONDS - (time.time() - data["sent_at"])
    if data["resends"] >= MAX_RESENDS or wait > 0:
        raise _error("RATE_LIMIT_EXCEEDED", {"seconds": max(0, int(wait + 0.999))})
    user = User.objects.filter(pk=data["user_id"]).first()
    if user is None:
        raise _error("EXPIRED_TWO_FACTOR_CODE")
    verification_code.revoke(verification_code.PURPOSE_SIGNIN, token)
    start_challenge(request, user, audience, data["next_path"], data["resends"] + 1)
