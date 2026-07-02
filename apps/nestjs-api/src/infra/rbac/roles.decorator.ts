import { SetMetadata } from "@nestjs/common";
import { ROLE } from "./roles";

export const RBAC_METADATA = "rbac";

/**
 * Mirrors plane/app/permissions/base.py @allow_permission(allowed_roles, level, creator, model).
 * Default level PROJECT (as in Django).
 */
export interface RoleOptions {
  roles: ROLE[];
  level?: "PROJECT" | "WORKSPACE";
  /** creator bypass: allow the object creator even without the role (needs `model`). */
  creator?: boolean;
  /** table name for the creator-bypass ownership check (created_by = user). */
  model?: string;
}

export const Roles = (options: RoleOptions) =>
  SetMetadata(RBAC_METADATA, { level: "PROJECT", creator: false, ...options } satisfies RoleOptions);
