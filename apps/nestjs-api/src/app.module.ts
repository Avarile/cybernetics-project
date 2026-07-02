import { Module, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { HealthController } from "./health.controller";
import { RedisModule } from "./infra/cache/redis.module";
import { AppConfigModule } from "./infra/config/config.module";
import { RequestContextInterceptor } from "./infra/context/request-context.interceptor";
import { DrizzleModule } from "./infra/database/drizzle.module";
import { AllExceptionsFilter } from "./infra/filters/all-exceptions.filter";
import { QueueModule } from "./infra/queue/queue.module";
import { SecurityModule } from "./infra/security.module";
import { AuthModule } from "./modules/auth/auth.module";
import { LabelModule } from "./modules/label/label.module";
import { StateModule } from "./modules/state/state.module";
import { UserModule } from "./modules/user/user.module";

/**
 * Root module shared by all three run modes (main / worker / scheduler).
 * Feature modules (workspace, project, issue, auth, ...) are added here as they are built.
 */
@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    AppConfigModule,
    DrizzleModule,
    RedisModule,
    QueueModule,
    SecurityModule,
    AuthModule,
    UserModule,
    StateModule,
    LabelModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true }) },
  ],
})
export class AppModule {}
