import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projects, workspaces } from "../../infra/database/schema";
import { deployBoards, type DeployBoard } from "./space.schema";

const genAnchor = (): string => randomBytes(16).toString("hex");

@Injectable()
export class SpaceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findActiveByAnchor(anchor: string): Promise<DeployBoard | null> {
    const [row] = await this.db
      .select()
      .from(deployBoards)
      .where(and(eq(deployBoards.anchor, anchor), eq(deployBoards.isDisabled, false)))
      .limit(1);
    return row ?? null;
  }

  /** find-or-create the project's project-level deploy board (entity_name = "project"). */
  async findOrCreateForProject(projectId: string): Promise<DeployBoard | null> {
    const [existing] = await this.db
      .select()
      .from(deployBoards)
      .where(and(eq(deployBoards.projectId, projectId), eq(deployBoards.entityName, "project")))
      .limit(1);
    if (existing) return existing;
    const [proj] = await this.db.select({ w: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return null;
    const [created] = await this.db
      .insert(deployBoards)
      .values({ workspaceId: proj.w, projectId, entityIdentifier: projectId, entityName: "project", anchor: genAnchor() })
      .returning();
    return created;
  }

  async projectMeta(projectId: string): Promise<{ projectName: string; workspaceSlug: string } | null> {
    const [row] = await this.db
      .select({ projectName: projects.name, workspaceSlug: workspaces.slug })
      .from(projects)
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(eq(projects.id, projectId))
      .limit(1);
    return row ?? null;
  }
}

export function serializeDeployBoard(b: DeployBoard) {
  return {
    anchor: b.anchor,
    entity_name: b.entityName,
    entity_identifier: b.entityIdentifier,
    project: b.projectId,
    workspace: b.workspaceId,
    comments: b.isCommentsEnabled,
    reactions: b.isReactionsEnabled,
    votes: b.isVotesEnabled,
    is_activity_enabled: b.isActivityEnabled,
    view_props: b.viewProps,
  };
}
