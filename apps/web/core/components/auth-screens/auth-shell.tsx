/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import Link from "next/link";
import { CyberneticsLockup } from "@plane/propel/icons";
import { AuthDescContent } from "./desc-content";
import { AuthFooter } from "./footer";

type TAuthShellProps = {
  /** Rendered in the top-right corner of the form column, e.g. the sign in / sign up switcher. */
  headerAction?: React.ReactNode;
  /** The form the screen is built around. */
  children: React.ReactNode;
};

/**
 * Shared frame for every unauthenticated screen: brand lockup, marketing panel
 * and a centered form column. The marketing panel collapses below `lg`.
 */
export function AuthShell({ headerAction, children }: TAuthShellProps) {
  return (
    <div className="relative z-10 h-full w-full overflow-x-hidden overflow-y-auto">
      <div className="flex min-h-full w-full">
        <Link href="/" className="fixed top-5 left-5 z-20 flex flex-none items-center">
          <CyberneticsLockup height={32} width={162} className="text-brand" />
        </Link>
        <AuthDescContent />
        <div className="relative flex flex-1 shrink-0 flex-col items-center justify-center">
          {headerAction && (
            <div className="absolute top-0 right-0 flex h-16 items-center justify-end px-5 lg:h-20">{headerAction}</div>
          )}
          <div className="relative w-full max-w-[22.5rem] px-4 py-20 lg:py-24">
            {children}
            <AuthFooter />
          </div>
        </div>
      </div>
    </div>
  );
}
