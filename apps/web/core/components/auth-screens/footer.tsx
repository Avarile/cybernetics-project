/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { AccentureLogo, DolbyLogo, SonyLogo, ZerodhaLogo } from "@plane/propel/icons";

// those auth page footers wont be needed for now, maybe in the future
const _BRAND_LOGOS: {
  id: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "zerodha",
    icon: <ZerodhaLogo className="h-7 w-24 text-[#387ED1]" />,
  },
  {
    id: "sony",
    icon: <SonyLogo className="h-7 w-16 dark:text-on-color" />,
  },
  {
    id: "dolby",
    icon: <DolbyLogo className="h-7 w-16 dark:text-on-color" />,
  },
  {
    id: "accenture",
    icon: <AccentureLogo className="h-7 w-24 dark:text-on-color" />,
  },
];

export function AuthFooter() {
  return (
    <footer className="mt-6 border-t border-subtle pt-4 text-center text-11 text-tertiary">
      <p>&copy; {new Date().getFullYear()} Cybernetics. All rights reserved.</p>
      <p className="mt-2">By Avarile.</p>
      {/* <div className="flex w-full flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {BRAND_LOGOS.map((brand) => (
          <div className="flex h-7 flex-1 items-center justify-center" key={brand.id}>
            {brand.icon}
          </div>
        ))}
      </div> */}
    </footer>
  );
}
