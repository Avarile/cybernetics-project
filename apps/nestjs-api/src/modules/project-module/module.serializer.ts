import type { Module } from "./module.schema";

// Mirrors ModuleSerializer read fields (snake_case wire keys). The issue-count / estimate-point /
// is_favorite fields are computed in Django from ModuleIssue + Issue + UserFavorite; those tables are
// not ported yet, so they are emitted with their Django defaults (0 / false) to keep the JSON shape
// stable. TODO(phase2): module-issues (needs issues table) — populate the computed counts.
export interface ModuleDTO {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string | null;
  description_text: Record<string, unknown> | null;
  description_html: Record<string, unknown> | null;
  start_date: string | null;
  target_date: string | null;
  status: string | null;
  lead_id: string | null;
  member_ids: string[];
  view_props: Record<string, unknown> | null;
  sort_order: number | null;
  external_source: string | null;
  external_id: string | null;
  logo_props: Record<string, unknown> | null;
  // computed (deferred — see TODO above)
  total_estimate_points: number;
  completed_estimate_points: number;
  is_favorite: boolean;
  total_issues: number;
  cancelled_issues: number;
  completed_issues: number;
  started_issues: number;
  unstarted_issues: number;
  backlog_issues: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function serializeModule(m: Module, memberIds: string[] = []): ModuleDTO {
  return {
    id: m.id,
    workspace_id: m.workspaceId,
    project_id: m.projectId,
    name: m.name,
    description: m.description,
    description_text: m.descriptionText,
    description_html: m.descriptionHtml,
    start_date: m.startDate,
    target_date: m.targetDate,
    status: m.status,
    lead_id: m.leadId,
    member_ids: memberIds,
    view_props: m.viewProps ?? {},
    sort_order: m.sortOrder,
    external_source: m.externalSource,
    external_id: m.externalId,
    logo_props: m.logoProps ?? {},
    // TODO(phase2): module-issues (needs issues table) — these are static defaults for now.
    total_estimate_points: 0,
    completed_estimate_points: 0,
    is_favorite: false,
    total_issues: 0,
    cancelled_issues: 0,
    completed_issues: 0,
    started_issues: 0,
    unstarted_issues: 0,
    backlog_issues: 0,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    archived_at: m.archivedAt ? m.archivedAt.toISOString() : null,
  };
}
