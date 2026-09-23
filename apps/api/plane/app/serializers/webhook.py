# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for workspace webhooks and their delivery logs.

Webhook URLs are validated against SSRF rules (allowed IPs/hosts) and a list of
disallowed domains that includes the Plane host itself, to prevent loops.
"""

# Python imports
import logging
from urllib.parse import urlparse

# Third party imports
from rest_framework import serializers

# Django imports
from django.conf import settings

# Module imports
from .base import DynamicBaseSerializer
from plane.db.models import Webhook, WebhookLog
from plane.db.models.webhook import validate_domain, validate_schema
from plane.utils.ip_address import validate_url

logger = logging.getLogger(__name__)


class WebhookSerializer(DynamicBaseSerializer):
    """Webhook configuration; the URL is validated on create and when changed on update."""

    url = serializers.URLField(validators=[validate_schema, validate_domain])

    def _validate_webhook_url(self, url):
        """Validate a webhook URL against SSRF and disallowed domain rules."""
        try:
            validate_url(
                url,
                allowed_ips=settings.WEBHOOK_ALLOWED_IPS,
                allowed_hosts=settings.WEBHOOK_ALLOWED_HOSTS,
            )
        except ValueError as e:
            logger.warning("Webhook URL validation failed for %s: %s", url, e)
            raise serializers.ValidationError({"url": "Invalid or disallowed webhook URL."})

        hostname = (urlparse(url).hostname or "").rstrip(".").lower()

        # Hosts explicitly trusted via WEBHOOK_ALLOWED_HOSTS bypass the
        # disallowed-domain check — they're already trusted for SSRF, so
        # the loop-back guard would only get in the way of legitimate
        # sibling services that share a parent domain with Plane.
        if hostname in settings.WEBHOOK_ALLOWED_HOSTS:
            return

        request = self.context.get("request")
        disallowed_domains = list(settings.WEBHOOK_DISALLOWED_DOMAINS)
        if request:
            request_host = request.get_host().split(":")[0].rstrip(".").lower()
            disallowed_domains.append(request_host)

        if any(hostname == domain or hostname.endswith("." + domain) for domain in disallowed_domains):
            raise serializers.ValidationError({"url": "URL domain or its subdomain is not allowed."})

    def create(self, validated_data):
        """Validate the URL and create the webhook."""
        url = validated_data.get("url", None)
        self._validate_webhook_url(url)
        return Webhook.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Re-validate the URL only if it is being changed, then update."""
        url = validated_data.get("url", None)
        if url:
            self._validate_webhook_url(url)
        return super().update(instance, validated_data)

    class Meta:
        model = Webhook
        fields = "__all__"
        read_only_fields = ["workspace", "secret_key", "deleted_at"]


class WebhookLogSerializer(DynamicBaseSerializer):
    """Webhook delivery log entry (request/response details for one delivery)."""

    class Meta:
        model = WebhookLog
        fields = "__all__"
        read_only_fields = ["workspace", "webhook"]
