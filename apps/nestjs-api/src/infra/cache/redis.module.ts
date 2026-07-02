import { Global, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Redis => {
        const url = cfg.get<string>("REDIS_URL", "redis://localhost:6379/0");
        // lazyConnect so the module initialises without a live Redis (connects on first command).
        return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  onModuleDestroy(): void {
    // Connections are closed by the process lifecycle; explicit quit handled in bootstrap teardown.
  }
}
