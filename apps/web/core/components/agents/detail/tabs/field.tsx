/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";

/** Labelled form row used across the agent tabs. */
export function AgentField({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-13 font-medium text-primary">{label}</span>
      {children}
      {help && <span className="text-11 text-tertiary">{help}</span>}
    </label>
  );
}

/** Read-only value row. */
export function AgentValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-13 font-medium text-primary">{label}</span>
      <div className="text-13 text-secondary">{value || "—"}</div>
    </div>
  );
}
