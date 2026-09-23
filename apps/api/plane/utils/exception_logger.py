# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Central helper for logging caught exceptions to the ``plane.exception`` logger."""

# Python imports
import logging
import traceback

# Django imports
from django.conf import settings


def log_exception(e, warning=False):
    """Log ``e`` as a warning (message only) or an error with traceback; dump the traceback at debug level in DEBUG."""
    # Log the error
    logger = logging.getLogger("plane.exception")

    if warning:
        logger.warning(str(e))
    else:
        logger.exception(e)

    if settings.DEBUG:
        logger.debug(traceback.format_exc())
    return
