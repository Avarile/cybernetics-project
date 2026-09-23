/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { layout, route } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * Extended routes are deep-merged into the core routes by `mergeRoutes`.
 * Layout file paths must match the ones in `core.ts` exactly for the merge to happen.
 */
export const extendedRoutes: RouteConfigEntry[] = [
  layout("./(all)/layout.tsx", [
    layout("./(all)/[workspaceSlug]/layout.tsx", [
      layout("./(all)/[workspaceSlug]/(settings)/layout.tsx", [
        // --------------------------------------------------------------------
        // PROJECT SETTINGS
        // --------------------------------------------------------------------
        layout("./(all)/[workspaceSlug]/(settings)/settings/projects/layout.tsx", [
          layout("./(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/layout.tsx", [
            // Project Cybernetics Data integration
            route(
              ":workspaceSlug/settings/projects/:projectId/cybernetics-data",
              "./(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/cybernetics-data/page.tsx"
            ),
          ]),
        ]),
      ]),
    ]),
  ]),
];
