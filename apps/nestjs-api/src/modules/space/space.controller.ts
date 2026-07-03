import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { IssueService } from "../issue/issue.service";
import { LabelRepository } from "../label/label.repository";
import { serializeLabel } from "../label/label.serializer";
import { StateRepository } from "../state/state.repository";
import { serializeState } from "../state/state.serializer";
import { Anchor } from "./anchor.guard";
import { AnchorGuard } from "./anchor.guard";
import { SpaceRepository, serializeDeployBoard } from "./space.repository";
import type { DeployBoard } from "./space.schema";

// Authenticated side: create/fetch a project's deploy anchor. Mirrors plane/space anchor create.
@Controller("api/public/workspaces/:slug/projects/:project_id")
@UseGuards(SessionGuard, RbacGuard)
export class SpaceAnchorController {
  constructor(private readonly repo: SpaceRepository) {}

  @Post("anchor")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  async createAnchor(@Param("slug") _slug: string, @Param("project_id") projectId: string) {
    const board = await this.repo.findOrCreateForProject(projectId);
    if (!board) throw new NotFoundException("The required object does not exist.");
    return serializeDeployBoard(board);
  }
}

// Anonymous side: published board reads gated purely by the anchor token.
@Controller("api/public/anchor/:anchor")
@UseGuards(AnchorGuard)
export class SpaceBoardController {
  constructor(
    private readonly space: SpaceRepository,
    private readonly states: StateRepository,
    private readonly labels: LabelRepository,
    private readonly issues: IssueService,
  ) {}

  @Get("settings")
  settings(@Anchor() board: DeployBoard) {
    return serializeDeployBoard(board);
  }

  @Get("meta")
  async meta(@Anchor() board: DeployBoard) {
    const meta = board.projectId ? await this.space.projectMeta(board.projectId) : null;
    return {
      anchor: board.anchor,
      entity_name: board.entityName,
      project_details: meta ? { name: meta.projectName } : null,
      workspace_details: meta ? { slug: meta.workspaceSlug } : null,
    };
  }

  @Get("states")
  async statesList(@Anchor() board: DeployBoard) {
    if (!board.projectId) return [];
    const rows = await this.states.listByProject(board.projectId);
    return rows.map((s) => serializeState(s));
  }

  @Get("labels")
  async labelsList(@Anchor() board: DeployBoard) {
    if (!board.projectId) return [];
    const rows = await this.labels.listByProject(board.projectId);
    return rows.map(serializeLabel);
  }

  @Get("issues")
  issuesList(@Anchor() board: DeployBoard, @Query("cursor") cursor?: string, @Query("per_page") perPage?: string) {
    if (!board.projectId) return { results: [] };
    return this.issues.list(board.projectId, { cursor, perPage: perPage ? Number(perPage) : undefined });
  }
}
