import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { MemberService } from "./member.service";
import { RBAC_METADATA, type RoleOptions } from "./roles.decorator";
import { ROLE } from "./roles";

/**
 * Reproduces @allow_permission semantics (plane/app/permissions/base.py): role gate at workspace or
 * project level, the workspace-admin-in-project override, and the creator bypass. Auth guards run
 * first (401 on anonymous), so req.user is present here.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly members: MemberService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<RoleOptions>(RBAC_METADATA, ctx.getHandler());
    if (!meta) return true; // no @Roles on the handler

    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const user = req.user;
    if (!user) throw this.forbidden();

    const slug = String(req.params.slug ?? "");
    const projectId = (req.params.project_id ?? req.params.pk) as string | undefined;
    const pk = String(req.params.pk ?? "");

    if (meta.creator && meta.model) {
      if (!(await this.members.isWorkspaceMember(slug, user.id))) throw this.forbidden();
      if (await this.members.isCreator(meta.model, pk, user.id)) return true;
    }

    if (meta.level === "WORKSPACE") {
      if (await this.members.hasWorkspaceRole(slug, user.id, meta.roles)) return true;
    } else {
      if (projectId && (await this.members.hasProjectRole(slug, projectId, user.id, meta.roles))) return true;
      // workspace-admin-in-project override
      if (
        projectId &&
        (await this.members.isProjectMember(slug, projectId, user.id)) &&
        (await this.members.hasWorkspaceRole(slug, user.id, [ROLE.ADMIN]))
      ) {
        return true;
      }
    }
    throw this.forbidden();
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ error: "You don't have the required permissions." });
  }
}
