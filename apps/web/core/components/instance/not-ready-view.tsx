/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { GOD_MODE_URL } from "@plane/constants";
import DefaultLayout from "@/layouts/default-layout";
import { CyberneticsLockup, CyberneticsMark } from "@plane/propel/icons";
import { Button } from "@plane/propel/button";

export function InstanceNotReady() {
  return (
    <DefaultLayout>
      <div className="relative z-10 flex h-screen w-screen overflow-hidden">
        {/* Background decorations — the mark itself, so they follow the theme instead of
            baking a light-mode gradient into a raster. */}
        <CyberneticsMark
          className="pointer-events-none absolute -top-24 -left-32 size-56 text-brand opacity-15"
          aria-hidden="true"
        />
        <CyberneticsMark
          className="pointer-events-none absolute -right-20 -bottom-16 size-56 text-brand opacity-15"
          aria-hidden="true"
        />
        {/* Main content */}
        <div className="flex h-full w-full flex-col items-center px-8 pt-6 pb-10">
          <div className="sticky top-0 flex w-full shrink-0 items-center justify-between gap-6">
            <CyberneticsLockup height={30} width={152} className="text-brand" />
          </div>
          <div className="flex h-full w-full flex-col items-center justify-center gap-7">
            <div className="flex flex-col items-center gap-11">
              <CyberneticsMark className="size-24 text-brand" role="img" aria-label="Cybernetics" />
              <div className="flex max-w-124 flex-col items-center gap-3">
                <h1 className="text-h2-semibold text-primary">Welcome to Cybernetics</h1>
                <p className="text-center text-body-md-regular text-secondary">
                  Set up your instance and create your first workspace to begin managing projects and work.
                </p>
              </div>
            </div>
            <a href={GOD_MODE_URL} className="w-72">
              <Button variant="primary" className="w-full" size="xl">
                Get started
              </Button>
            </a>
          </div>
        </div>
      </div>
    </DefaultLayout>
  );
}
