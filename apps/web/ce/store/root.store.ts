/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// store
import { CoreRootStore } from "@/store/root.store";
import type { ICyberneticsDataStore } from "./cybernetics-data.store";
import { CyberneticsDataStore } from "./cybernetics-data.store";
import type { ITimelineStore } from "./timeline";
import { TimeLineStore } from "./timeline";

export class RootStore extends CoreRootStore {
  timelineStore: ITimelineStore;
  cyberneticsData: ICyberneticsDataStore;

  constructor() {
    super();

    this.timelineStore = new TimeLineStore(this);
    this.cyberneticsData = new CyberneticsDataStore(this);
  }

  resetOnSignOut() {
    super.resetOnSignOut();
    this.cyberneticsData = new CyberneticsDataStore(this);
  }
}
