import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { ConfigService } from "../../infra/config/config.service";
import { InstanceConfigService } from "../../infra/config/instance-config.service";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { AiLiteRepository } from "./ai-lite.repository";
import { AiAssistantDto } from "./ai.dto";
import { MastraAiService } from "./mastra-ai.service";

const TASK_REQUIRED = { error: "Task is required" };
const LLM_REQUIRED = { error: "LLM provider API key and model are required" };
const INTERNAL_ERROR = { error: "An internal error has occurred." };

@Controller("api")
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: MastraAiService,
    private readonly lite: AiLiteRepository,
    private readonly instanceConfig: InstanceConfigService,
    private readonly config: ConfigService,
  ) {}

  // POST /api/workspaces/:slug/projects/:projectId/ai-assistant/  (project-scoped GPT integration)
  @Post("workspaces/:slug/projects/:project_id/ai-assistant")
  @UseGuards(SessionGuard, RbacGuard)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  async projectAssistant(
    @Param("slug") slug: string,
    @Param("project_id") projectId: string,
    @Body() body: AiAssistantDto,
  ) {
    const cfg = await this.ai.getLlmConfig();
    if (!cfg) throw new BadRequestException(LLM_REQUIRED);
    if (!body.task) throw new BadRequestException(TASK_REQUIRED);

    let out;
    try {
      out = await this.ai.generate(cfg, body.task, body.prompt);
    } catch (e) {
      this.logger.error(e);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    const [project_detail, workspace_detail] = await Promise.all([
      this.lite.projectLite(projectId),
      this.lite.workspaceLite(slug),
    ]);
    return { ...out, project_detail, workspace_detail };
  }

  // POST /api/workspaces/:slug/ai-assistant/  (workspace-scoped GPT integration)
  @Post("workspaces/:slug/ai-assistant")
  @UseGuards(SessionGuard, RbacGuard)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  async workspaceAssistant(@Param("slug") _slug: string, @Body() body: AiAssistantDto) {
    const cfg = await this.ai.getLlmConfig();
    if (!cfg) throw new BadRequestException(LLM_REQUIRED);
    if (!body.task) throw new BadRequestException(TASK_REQUIRED);

    try {
      return await this.ai.generate(cfg, body.task, body.prompt);
    } catch (e) {
      this.logger.error(e);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  // GET /api/unsplash/  (co-located image proxy; returns [] when unconfigured)
  @Get("unsplash")
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async unsplash(
    @Query("query") query?: string,
    @Query("page") page = "1",
    @Query("per_page") perPage = "20",
  ): Promise<unknown> {
    const accessKey = await this.instanceConfig.getConfigurationValue(
      "UNSPLASH_ACCESS_KEY",
      this.config.get<string>("UNSPLASH_ACCESS_KEY"),
    );
    if (!accessKey) return [];

    // fix-forward: Django has a literal `$${page}` bug in the search URL; we use the correct value.
    const url = query
      ? `https://api.unsplash.com/search/photos/?client_id=${accessKey}&query=${query}&page=${page}&per_page=${perPage}`
      : `https://api.unsplash.com/photos/?client_id=${accessKey}&page=${page}&per_page=${perPage}`;

    const resp = await fetch(url, { headers: { "Content-Type": "application/json" } });
    return resp.json();
  }
}
