import { Module } from "@nestjs/common";
import { InstanceController } from "./instance.controller";
import { InstanceRepository } from "./instance.repository";

/**
 * Instance/license surface. Currently the public bootstrap GET /api/instances/ (the read the whole
 * frontend loads from). ConfigService/InstanceConfigService come from the global AppConfigModule.
 */
@Module({
  controllers: [InstanceController],
  providers: [InstanceRepository],
})
export class InstanceModule {}
