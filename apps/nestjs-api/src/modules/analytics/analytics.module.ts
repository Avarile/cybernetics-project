import { Module } from "@nestjs/common";
import { AdvanceAnalyticsController } from "./advance-analytics.controller";
import { AdvanceAnalyticsService } from "./advance-analytics.service";
import { AnalyticViewRepository } from "./analytic-view.repository";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { ProjectAdvanceAnalyticsController } from "./project-advance-analytics.controller";
import { ProjectAdvanceAnalyticsService } from "./project-advance-analytics.service";

/**
 * Analytics surface (plane/app/urls/analytic.py): the classic endpoints (AnalyticsEndpoint,
 * DefaultAnalytics, ProjectStats, SavedAnalytic, ExportAnalytics + AnalyticView CRUD) plus the
 * advance-analytics dashboard surface (workspace + project-scoped). Reuses the global QueueModule
 * (CeleryProducer) for the export task.
 */
@Module({
  controllers: [AnalyticsController, AdvanceAnalyticsController, ProjectAdvanceAnalyticsController],
  providers: [AnalyticsService, AnalyticViewRepository, AdvanceAnalyticsService, ProjectAdvanceAnalyticsService],
})
export class AnalyticsModule {}
