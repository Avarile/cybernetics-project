import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config.service";
import { CryptoService } from "./crypto.service";
import { InstanceConfigService } from "./instance-config.service";

@Global()
@Module({
  providers: [ConfigService, CryptoService, InstanceConfigService],
  exports: [ConfigService, CryptoService, InstanceConfigService],
})
export class AppConfigModule {}
