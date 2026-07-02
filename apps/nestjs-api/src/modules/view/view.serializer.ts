import type { IssueView } from "./view.schema";

/**
 * Mirrors IssueViewSerializer (DynamicBaseSerializer, fields = "__all__").
 * Django exposes FK columns under their bare model-field names (pk values), NOT the `_id` suffix —
 * hence `workspace` / `project` / `owned_by` / `created_by` / `updated_by` (unlike State/Label which
 * hand-picked `project_id` / `workspace_id`). read_only fields: workspace, project, query, owned_by,
 * access, is_locked. `is_favorite` is a read-only annotation (UserFavorite domain — deferred).
 */
export interface ViewDTO {
  id: string;
  workspace: string;
  project: string | null;
  owned_by: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  name: string;
  description: string | null;
  query: Record<string, unknown> | null;
  filters: Record<string, unknown> | null;
  display_filters: Record<string, unknown> | null;
  display_properties: Record<string, unknown> | null;
  rich_filters: Record<string, unknown> | null;
  access: number | null;
  sort_order: number | null;
  logo_props: Record<string, unknown> | null;
  is_locked: boolean | null;
  archived_at: Date | null;
  is_favorite: boolean;
}

export function serializeView(v: IssueView, isFavorite = false): ViewDTO {
  return {
    id: v.id,
    workspace: v.workspaceId,
    project: v.projectId,
    owned_by: v.ownedBy,
    created_by: v.createdBy,
    updated_by: v.updatedBy,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    deleted_at: v.deletedAt,
    name: v.name,
    description: v.description,
    query: v.query,
    filters: v.filters,
    display_filters: v.displayFilters,
    display_properties: v.displayProperties,
    rich_filters: v.richFilters,
    access: v.access,
    sort_order: v.sortOrder,
    logo_props: v.logoProps,
    is_locked: v.isLocked,
    archived_at: v.archivedAt,
    is_favorite: isFavorite,
  };
}
