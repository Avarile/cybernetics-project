import { Module } from "@nestjs/common";
import { IssueModule } from "../issue/issue.module";
import { LabelModule } from "../label/label.module";
import { StateModule } from "../state/state.module";
import { AnchorGuard } from "./anchor.guard";
import { SpaceAnchorController, SpaceBoardController } from "./space.controller";
import { SpaceRepository } from "./space.repository";

/**
 * Public "spaces" API (/api/public) — anonymous published boards via a deploy-board anchor token,
 * plus the authenticated anchor-create route. Reuses the domain repositories for board data.
 */
@Module({
  imports: [IssueModule, StateModule, LabelModule],
  controllers: [SpaceAnchorController, SpaceBoardController],
  providers: [SpaceRepository, AnchorGuard],
})
export class SpaceModule {}
