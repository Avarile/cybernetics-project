import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { CryptoService } from "./crypto.service";
import { InstanceConfigService } from "./instance-config.service";

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, cache: true })],
  providers: [CryptoService, InstanceConfigService],
  exports: [CryptoService, InstanceConfigService, NestConfigModule],
})
export class AppConfigModule {}
