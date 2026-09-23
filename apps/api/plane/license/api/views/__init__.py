# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Re-exports the instance-admin API endpoints wired up in ``plane/license/urls.py``."""

from .instance import InstanceEndpoint, SignUpScreenVisitedEndpoint


from .configuration import (
    EmailCredentialCheckEndpoint,
    InstanceConfigurationEndpoint,
    DisableEmailFeatureEndpoint,
)


from .admin import (
    InstanceAdminEndpoint,
    InstanceAdminSignInEndpoint,
    InstanceAdminSignUpEndpoint,
    InstanceAdminUserMeEndpoint,
    InstanceAdminSignOutEndpoint,
    InstanceAdminUserSessionEndpoint,
)


from .workspace import (
    InstanceWorkSpaceAvailabilityCheckEndpoint,
    InstanceWorkSpaceEndpoint,
)
