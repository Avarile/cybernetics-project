import { Global, Module } from "@nestjs/common";
import { LiveServiceClient } from "./live-service.client";

@Global()
@Module({
  providers: [LiveServiceClient],
  exports: [LiveServiceClient],
})
export class LiveServiceModule {}
