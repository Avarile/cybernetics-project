import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../database/drizzle.module";
import { projectMembers, workspaceMembers, workspaces } from "../database/schema";
import type { ROLE } from "./roles";

/**
 * Membership/role queries — direct Drizzle translations of the querysets used by
 * plane/app/permissions/{workspace,project}.py and @allow_permission. All checks require is_active.
 */
@Injectable()
export class MemberService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async isWorkspaceMember(slug: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ x: sql`1` })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaces.slug, slug), eq(workspaceMembers.memberId, userId), eq(workspaceMembers.isActive, true)))
      .limit(1);
    return rows.length > 0;
  }

  async hasWorkspaceRole(slug: string, userId: string, roles: ROLE[]): Promise<boolean> {
    if (roles.length === 0) return false;
    const rows = await this.db
      .select({ x: sql`1` })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaces.slug, slug),
          eq(workspaceMembers.memberId, userId),
          eq(workspaceMembers.isActive, true),
          inArray(workspaceMembers.role, roles as unknown as number[]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async isProjectMember(slug: string, projectId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ x: sql`1` })
      .from(projectMembers)
      .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
      .where(
        and(
          eq(workspaces.slug, slug),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberId, userId),
          eq(projectMembers.isActive, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hasProjectRole(slug: string, projectId: string, userId: string, roles: ROLE[]): Promise<boolean> {
    if (roles.length === 0) return false;
    const rows = await this.db
      .select({ x: sql`1` })
      .from(projectMembers)
      .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
      .where(
        and(
          eq(workspaces.slug, slug),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberId, userId),
          eq(projectMembers.isActive, true),
          inArray(projectMembers.role, roles as unknown as number[]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** creator bypass: is the current user the created_by of the target row in `table`? */
  async isCreator(table: string, pk: string, userId: string): Promise<boolean> {
    if (!pk) return false;
    const rows = await this.db.execute(
      sql`select 1 from ${sql.identifier(table)} where id = ${pk} and created_by = ${userId} limit 1`,
    );
    return (rows as unknown as unknown[]).length > 0;
  }
}
