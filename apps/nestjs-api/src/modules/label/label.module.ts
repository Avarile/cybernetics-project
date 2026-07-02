import { Module } from "@nestjs/common";
import { LabelController } from "./label.controller";
import { LabelRepository } from "./label.repository";
import { LabelService } from "./label.service";

@Module({
  controllers: [LabelController],
  providers: [LabelService, LabelRepository],
  exports: [LabelService, LabelRepository],
})
export class LabelModule {}
