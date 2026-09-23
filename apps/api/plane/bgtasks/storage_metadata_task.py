# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that fetches object metadata from S3-compatible storage for a FileAsset.

Enqueued after an asset upload is confirmed so the stored metadata (size, content type, etc.)
reflects what actually landed in the bucket.
"""

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage
from plane.utils.exception_logger import log_exception


@shared_task
def get_asset_object_metadata(asset_id):
    """Read the asset's object metadata from storage and save it to ``FileAsset.storage_metadata``."""
    try:
        # Get the asset
        asset = FileAsset.objects.get(pk=asset_id)
        # Create an instance of the S3 storage
        storage = S3Storage()
        # Get the storage
        asset.storage_metadata = storage.get_object_metadata(object_name=asset.asset.name)
        # Save the asset
        asset.save(update_fields=["storage_metadata"])
        return
    except FileAsset.DoesNotExist:
        return
    except Exception as e:
        log_exception(e)
        return
