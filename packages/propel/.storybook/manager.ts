/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

const cyberneticsTheme = create({
  base: "dark",
  brandTitle: "Cybernetics UI",
  brandUrl: "/",
  brandImage: "cybernetics-lockup-cream.svg",
  brandTarget: "_self",
});

addons.setConfig({
  theme: cyberneticsTheme,
});
