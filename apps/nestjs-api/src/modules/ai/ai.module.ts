import { Module } from "@nestjs/common";
import { AiLiteRepository } from "./ai-lite.repository";
import { AiController } from "./ai.controller";
import { MastraAiService } from "./mastra-ai.service";

/**
 * AI surface (plane/app/views/external/base.py): the two `ai-assistant/` GPT endpoints backed by a
 * Mastra Agent, plus the co-located Unsplash proxy. InstanceConfigService/ConfigService come from the
 * global AppConfigModule; auth/RBAC guards from the global SecurityModule.
 */
@Module({
  controllers: [AiController],
  providers: [MastraAiService, AiLiteRepository],
  exports: [MastraAiService],
})
export class AiModule {}
