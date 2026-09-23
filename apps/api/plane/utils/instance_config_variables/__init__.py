# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Aggregated list of instance configuration variables.

Each entry describes a key seeded into the InstanceConfiguration table (e.g. by
the ``configure_instance`` management command) with its env-var default.
"""

from .core import core_config_variables
from .extended import extended_config_variables

instance_config_variables = [*core_config_variables, *extended_config_variables]
