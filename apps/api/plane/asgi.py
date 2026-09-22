# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.production")

from channels.routing import ProtocolTypeRouter  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()

from plane.mcp.asgi import with_mcp  # noqa: E402

# Serves the MCP endpoint next to Django when MCP_SERVER_ENABLED is set (see plane/mcp)
application = with_mcp(ProtocolTypeRouter({"http": django_asgi_app}), django_asgi_app)
