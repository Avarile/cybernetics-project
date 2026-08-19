/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CyberneticsLoader, type TCyberneticsLoaderSize } from "@plane/propel/icons";

type TLogoSpinnerProps = {
  /** `lg` for full-page waits (the default), `md` for panels and inline regions. */
  size?: TCyberneticsLoaderSize;
  className?: string;
};

/**
 * The brand loading state. Drawn rather than played back from a GIF, so it needs
 * no per-theme asset and follows the accent token into every theme.
 */
export function LogoSpinner({ size = "lg", className }: TLogoSpinnerProps) {
  return (
    <div className="flex items-center justify-center">
      <CyberneticsLoader size={size} className={className ?? "text-accent-primary"} />
    </div>
  );
}
