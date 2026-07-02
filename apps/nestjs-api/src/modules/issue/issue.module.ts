import { Module } from "@nestjs/common";
import { IssueController } from "./issue.controller";
import { IssueRepository } from "./issue.repository";
import { IssueService } from "./issue.service";

@Module({
  controllers: [IssueController],
  providers: [IssueService, IssueRepository],
  exports: [IssueService, IssueRepository],
})
export class IssueModule {}
