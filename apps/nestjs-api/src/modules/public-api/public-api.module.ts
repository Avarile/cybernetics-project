import { Module } from "@nestjs/common";
import { IssueModule } from "../issue/issue.module";
import { LabelModule } from "../label/label.module";
import { StateModule } from "../state/state.module";
import { LabelV1Controller } from "./label.v1.controller";
import { ProjectReadRepository } from "./project-read.repository";
import { ProjectV1Controller } from "./project.v1.controller";
import { StateV1Controller } from "./state.v1.controller";
import { WorkItemV1Controller } from "./work-item.v1.controller";

/**
 * External v1 API (/api/v1, X-Api-Key + throttle) — thin controllers reusing the domain services.
 * (Mirrors plane/api/urls/*.) cycles/modules/members/estimates v1 controllers follow the same
 * pattern and can be added incrementally.
 */
@Module({
  imports: [IssueModule, StateModule, LabelModule],
  controllers: [WorkItemV1Controller, StateV1Controller, LabelV1Controller, ProjectV1Controller],
  providers: [ProjectReadRepository],
})
export class PublicApiModule {}
