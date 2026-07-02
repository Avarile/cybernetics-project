import { Module } from "@nestjs/common";
import { ActivityRepository } from "./activity.repository";
import { IssueActivityHandler } from "./issue-activity.handler";

// Worker-side: the IssueActivityHandler is discovered by TaskHandlerRegistry via @CeleryTaskHandler.
@Module({
  providers: [ActivityRepository, IssueActivityHandler],
  exports: [ActivityRepository],
})
export class ActivityModule {}
