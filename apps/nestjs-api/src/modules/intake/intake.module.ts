import { Module } from "@nestjs/common";
import { IssueModule } from "../issue/issue.module";
import { IntakeController, IntakeIssueController } from "./intake.controller";
import { IntakeRepository } from "./intake.repository";
import { IntakeService } from "./intake.service";

// IssueModule exports IssueRepository, which the service injects to create/annotate issues.
@Module({
  imports: [IssueModule],
  controllers: [IntakeController, IntakeIssueController],
  providers: [IntakeService, IntakeRepository],
  exports: [IntakeService, IntakeRepository],
})
export class IntakeModule {}
