/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { AnimatedGridPattern } from "./animated-grid-pattern";

const AUTH_DESC_CONTENT = {
  title: "Plan, build, and ship in one continuous loop",
  description:
    "Cybernetics is the AI-first work platform where your team and its agents plan, execute, and course-correct together.",
};

/**
 * The marketing half of the auth screen. Collapses away below `lg` so that
 * small viewports get the form on its own.
 */
export function AuthDescContent() {
  return (
    <div className="shadow-lg relative hidden flex-1 shrink basis-1/4 items-center justify-center border-r border-subtle p-10 lg:flex">
      <AnimatedGridPattern
        className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,white,transparent_80%)]"
        width={40}
        height={40}
        numSquares={40}
        maxOpacity={0.15}
        duration={3}
        repeatDelay={0.5}
      />
      <div className="flex flex-col gap-10">
        <h2 className="text-h1-bold text-primary xl:text-40 xl:leading-[1.15]">{AUTH_DESC_CONTENT.title}</h2>
        <p className="text-body-md-regular text-secondary">{AUTH_DESC_CONTENT.description}</p>
      </div>
    </div>
  );
}
