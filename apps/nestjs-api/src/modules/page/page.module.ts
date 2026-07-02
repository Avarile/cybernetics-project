import { Module } from "@nestjs/common";
import { PageController } from "./page.controller";
import { PageRepository } from "./page.repository";
import { PageService } from "./page.service";

@Module({
  controllers: [PageController],
  providers: [PageService, PageRepository],
  exports: [PageService, PageRepository],
})
export class PageModule {}
