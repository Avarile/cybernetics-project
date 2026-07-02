import { Module } from "@nestjs/common";
import { ArchivedModuleController, ModuleController } from "./module.controller";
import { ModuleRepository } from "./module.repository";
import { ModuleService } from "./module.service";

// Django `module` domain (Module entity CRUD + archive). Named ProjectModuleModule to avoid clashing
// with NestJS's own `Module` decorator / the word "module". DB table + routes stay `modules`.
@Module({
  controllers: [ModuleController, ArchivedModuleController],
  providers: [ModuleService, ModuleRepository],
  exports: [ModuleService, ModuleRepository],
})
export class ProjectModuleModule {}
