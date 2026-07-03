import { Module } from "@nestjs/common";
import { TRACKING_HANDLERS } from "./tracking.handlers";
import { TrackingRepository } from "./tracking.repository";

// Worker-side tracking handlers: recent_visited_task + crawl_work_item_link_title.
@Module({
  providers: [TrackingRepository, ...TRACKING_HANDLERS],
  exports: [TrackingRepository],
})
export class TrackingModule {}
