/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function FormContainer({ children }: { children: React.ReactNode }) {
  return <div className="relative flex w-full flex-col gap-6">{children}</div>;
}
