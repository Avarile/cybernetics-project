# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks that send the two-factor authentication emails.

``two_factor_code_email`` sends a code (turning 2FA on or off, or signing in to the
app or the admin console); ``two_factor_changed_email`` tells the user 2FA was
turned on or off. SMTP settings come from the instance configuration, as for the
magic sign-in code. Codes never go in the subject or the preheader.
"""

# Python imports
import logging
from urllib.parse import urlencode

# Third party imports
from celery import shared_task

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Module imports
from plane.authentication.utils.request_meta import mask_email
from plane.authentication.utils.verification_code import CODE_TTL_SECONDS
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception

BRAND_NAME = "Cybernetics Projects"

_SIGNIN_WARNING = {
    "warning_title": "Didn't try to sign in?",
    "warning": "Someone else knows your password. Don't share this code, and reset your password.",
}
_SETUP_WARNING = {
    "warning_title": "Didn't ask for this?",
    "warning": "Someone may know your password. Change it now.",
}

CODE_EMAILS = {
    "enable": {
        "subject": "Confirm turning on two-factor authentication",
        "preheader": "Use this code to finish turning on two-factor authentication.",
        "heading": "Confirm two-factor authentication",
        "intro": (
            f"You asked to turn on two-factor authentication for your {BRAND_NAME} account. "
            "Enter this code in Profile settings → Security to confirm."
        ),
        **_SETUP_WARNING,
    },
    "disable": {
        "subject": "Confirm turning off two-factor authentication",
        "preheader": "Use this code to finish turning off two-factor authentication.",
        "heading": "Confirm turning off two-factor authentication",
        "intro": (
            "You asked to turn off two-factor authentication. Enter this code in Profile settings → Security "
            "to confirm. Once it's off, your account will be protected by your password alone."
        ),
        **_SETUP_WARNING,
    },
    "signin": {
        "subject": "Your sign-in verification code",
        "preheader": "Your password was entered. Enter the code to finish signing in.",
        "heading": "Your sign-in code",
        "intro": (
            f"Your password was entered correctly. To finish signing in to {BRAND_NAME}, "
            "enter this code on the sign-in page."
        ),
        **_SIGNIN_WARNING,
    },
    "admin_signin": {
        "subject": "Your admin sign-in verification code",
        "preheader": "Your password was entered. Enter the code to finish signing in to the admin console.",
        "heading": "Your admin sign-in code",
        "intro": (
            f"Your password was entered correctly. To finish signing in to the {BRAND_NAME} admin console, "
            "enter this code on the sign-in page."
        ),
        **_SIGNIN_WARNING,
    },
}

CHANGED_EMAILS = {
    True: {
        "subject": "Two-factor authentication turned on",
        "preheader": "Signing in with your password now also needs a code sent to this email.",
        "heading": "Two-factor authentication turned on",
        "intro": (
            "Two-factor authentication is now on. Signing in with your password will also need a code sent to "
            "this email. Email-code, Google and GitHub sign-ins aren't affected. Password sign-in on public "
            "spaces is no longer available; use an email code there instead."
        ),
        "warning_title": "",
        "warning": "",
        "action_text": "If this wasn't you, reset your password.",
    },
    False: {
        "subject": "Two-factor authentication turned off",
        "preheader": "Your account is now protected by your password only.",
        "heading": "Two-factor authentication turned off",
        "intro": "Two-factor authentication was turned off. Your account is now protected by your password only.",
        "warning_title": "Wasn't you?",
        "warning": "Reset your password now and turn two-factor authentication back on.",
        "action_text": "",
    },
}


def render_code_email(email, code, purpose, meta, current_site):
    """Return ``(subject, html)`` for a code email; ``purpose`` is a key of CODE_EMAILS."""
    copy = CODE_EMAILS[purpose]
    current_site = str(current_site).rstrip("/")
    context = {
        **copy,
        "brand_name": BRAND_NAME,
        "code_display": f"{code[:3]} {code[3:]}",
        "expires_minutes": CODE_TTL_SECONDS // 60,
        "meta": meta,
        "masked_email": mask_email(email),
        "current_site": current_site,
    }
    html = render_to_string("emails/auth/two_factor_code.html", context)
    return f"{copy['subject']} – {BRAND_NAME}", html


def render_changed_email(email, enabled, meta, current_site):
    """Return ``(subject, html)`` for the 'two-factor authentication turned on/off' notice."""
    copy = CHANGED_EMAILS[bool(enabled)]
    current_site = str(current_site).rstrip("/")
    reset_url = f"{current_site}/accounts/forgot-password/?{urlencode({'email': email})}"
    context = {
        **copy,
        "brand_name": BRAND_NAME,
        "meta": meta,
        "masked_email": mask_email(email),
        "current_site": current_site,
        "reset_url": reset_url,
    }
    html = render_to_string("emails/auth/two_factor_changed.html", context)
    return f"{copy['subject']} – {BRAND_NAME}", html


def _send(email, subject, html_content):
    (
        EMAIL_HOST,
        EMAIL_HOST_USER,
        EMAIL_HOST_PASSWORD,
        EMAIL_PORT,
        EMAIL_USE_TLS,
        EMAIL_USE_SSL,
        EMAIL_FROM,
    ) = get_email_configuration()

    connection = get_connection(
        host=EMAIL_HOST,
        port=int(EMAIL_PORT),
        username=EMAIL_HOST_USER,
        password=EMAIL_HOST_PASSWORD,
        # Instance config stores booleans as "1"/"0" strings
        use_tls=EMAIL_USE_TLS == "1",
        use_ssl=EMAIL_USE_SSL == "1",
    )
    msg = EmailMultiAlternatives(
        subject=subject,
        body=generate_plain_text_from_html(html_content),
        from_email=EMAIL_FROM,
        to=[email],
        connection=connection,
    )
    msg.attach_alternative(html_content, "text/html")
    msg.send()
    logging.getLogger("plane.worker").info("Email sent successfully.")


@shared_task
def two_factor_code_email(email, code, purpose, meta, current_site):
    """Email a two-factor code; ``purpose`` is "enable", "disable", "signin" or "admin_signin".

    Errors are logged and swallowed; the user can ask for a new code.
    """
    try:
        subject, html_content = render_code_email(email, code, purpose, meta, current_site)
        _send(email, subject, html_content)
    except Exception as e:
        log_exception(e)


@shared_task
def two_factor_changed_email(email, enabled, meta, current_site):
    """Tell the user two-factor authentication was turned on (``enabled``) or off. Errors are logged and swallowed."""
    try:
        subject, html_content = render_changed_email(email, enabled, meta, current_site)
        _send(email, subject, html_content)
    except Exception as e:
        log_exception(e)
