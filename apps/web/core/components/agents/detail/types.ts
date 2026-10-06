/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IWorkspaceAgent, TAgentPayload } from "@plane/types";

/** Props every agent detail tab receives. */
export type TAgentTabProps = {
  workspaceSlug: string;
  agent: IWorkspaceAgent;
  /** Saved agent with unsaved edits applied. */
  draft: IWorkspaceAgent;
  /** Unsaved edits only. */
  changes: TAgentPayload;
  onChange: (patch: TAgentPayload) => void;
  canEdit: boolean;
};
