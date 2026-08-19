/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CyberneticsLoader } from "@plane/propel/icons";

export function InstanceLoading() {
  return (
    <div className="flex items-center justify-center">
      <CyberneticsLoader size="lg" className="text-accent-primary" />
    </div>
  );
}
