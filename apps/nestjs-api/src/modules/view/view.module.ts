import { Module } from "@nestjs/common";
import { ProjectViewController, WorkspaceViewController } from "./view.controller";
import { ViewRepository } from "./view.repository";
import { ViewService } from "./view.service";

@Module({
  controllers: [ProjectViewController, WorkspaceViewController],
  providers: [ViewService, ViewRepository],
  exports: [ViewService, ViewRepository],
})
export class ViewModule {}
