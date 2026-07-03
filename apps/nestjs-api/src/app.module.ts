import { MiddlewareConsumer, Module, type NestModule, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { HealthController } from "./health.controller";
import { RedisModule } from "./infra/cache/redis.module";
import { AppConfigModule } from "./infra/config/config.module";
import { ContextModule } from "./infra/context/context.module";
import { RequestContextInterceptor } from "./infra/context/request-context.interceptor";
import { RequestContextMiddleware } from "./infra/context/request-context.middleware";
import { DrizzleModule } from "./infra/database/drizzle.module";
import { AllExceptionsFilter } from "./infra/filters/all-exceptions.filter";
import { LiveServiceModule } from "./infra/live-service/live-service.module";
import { MailerModule } from "./infra/mailer/mailer.module";
import { StorageModule } from "./infra/storage/storage.module";
import { QueueModule } from "./infra/queue/queue.module";
import { SchedulerModule } from "./infra/scheduler/scheduler.module";
import { SecurityModule } from "./infra/security.module";
import { ActivityModule } from "./modules/activity/activity.module";
import { AssetModule } from "./modules/asset/asset.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CycleModule } from "./modules/cycle/cycle.module";
import { EmailModule } from "./modules/email/email.module";
import { EstimateModule } from "./modules/estimate/estimate.module";
import { IntakeModule } from "./modules/intake/intake.module";
import { IssueModule } from "./modules/issue/issue.module";
import { LabelModule } from "./modules/label/label.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { PageModule } from "./modules/page/page.module";
import { ProjectModuleModule } from "./modules/project-module/module.module";
import { StateModule } from "./modules/state/state.module";
import { TelemetryModule } from "./modules/telemetry/telemetry.module";
import { TrackingModule } from "./modules/tracking/tracking.module";
import { UserModule } from "./modules/user/user.module";
import { ViewModule } from "./modules/view/view.module";
import { WebhookModule } from "./modules/webhook/webhook.module";

/**
 * Root module shared by all three run modes (main / worker / scheduler).
 * Feature modules (workspace, project, issue, ...) are added here as they are built.
 */
@Module({
  imports: [
    ContextModule,
    AppConfigModule,
    DrizzleModule,
    RedisModule,
    QueueModule,
    SchedulerModule,
    MailerModule,
    StorageModule,
    LiveServiceModule,
    SecurityModule,
    AuthModule,
    UserModule,
    StateModule,
    LabelModule,
    IssueModule,
    CycleModule,
    ProjectModuleModule,
    EstimateModule,
    ViewModule,
    IntakeModule,
    PageModule,
    ActivityModule,
    WebhookModule,
    NotificationModule,
    EmailModule,
    MaintenanceModule,
    TelemetryModule,
    AssetModule,
    TrackingModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true }) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
