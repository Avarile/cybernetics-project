import type { Cycle } from "./cycle.schema";

// Mirrors CycleSerializer (plane/app/serializers/cycle.py) — snake_case wire keys.
export interface CycleDTO {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  owned_by_id: string;
  view_props: Record<string, unknown>;
  sort_order: number;
  external_source: string | null;
  external_id: string | null;
  progress_snapshot: Record<string, unknown>;
  logo_props: Record<string, unknown>;
  // active | upcoming | completed | draft — computable purely from start/end dates (no issues needed).
  status: CycleStatus;
  // Included in the archived-cycle payload (CycleArchiveUnarchiveEndpoint), omitted otherwise.
  archived_at?: string | null;
  // TODO(phase2): cycle-issues (needs issues table) — is_favorite/total_issues and the per-state-group
  // issue counts are derived from CycleIssue -> Issue joins. Defaulted here to keep the wire shape
  // matching Django until the issues table lands.
  is_favorite: boolean;
  total_issues: number;
  cancelled_issues: number;
  completed_issues: number;
  started_issues: number;
  unstarted_issues: number;
  backlog_issues: number;
}

export type CycleStatus = "CURRENT" | "UPCOMING" | "COMPLETED" | "DRAFT";

/**
 * Reproduces the Django `status` Case() annotation (cycle/base.py). Django compares against the
 * project-timezone-adjusted "now"; we compare against UTC now (project-timezone conversion is a
 * phase-2 refinement — see the create/update date handling note in cycle.service.ts).
 */
export function computeCycleStatus(startDate: Date | null, endDate: Date | null, now: Date = new Date()): CycleStatus {
  if (startDate && endDate) {
    if (startDate <= now && endDate >= now) return "CURRENT";
    if (startDate > now) return "UPCOMING";
    if (endDate < now) return "COMPLETED";
  }
  if (startDate && !endDate && startDate > now) return "UPCOMING";
  if (!startDate && endDate && endDate < now) return "COMPLETED";
  return "DRAFT";
}

export function serializeCycle(c: Cycle, opts: { includeArchivedAt?: boolean } = {}): CycleDTO {
  const dto: CycleDTO = {
    id: c.id,
    workspace_id: c.workspaceId,
    project_id: c.projectId,
    name: c.name,
    description: c.description,
    start_date: c.startDate ? c.startDate.toISOString() : null,
    end_date: c.endDate ? c.endDate.toISOString() : null,
    owned_by_id: c.ownedBy,
    view_props: c.viewProps,
    sort_order: c.sortOrder,
    external_source: c.externalSource,
    external_id: c.externalId,
    progress_snapshot: c.progressSnapshot,
    logo_props: c.logoProps,
    status: computeCycleStatus(c.startDate, c.endDate),
    // TODO(phase2): cycle-issues (needs issues table) — real values once CycleIssue/Issue exist.
    is_favorite: false,
    total_issues: 0,
    cancelled_issues: 0,
    completed_issues: 0,
    started_issues: 0,
    unstarted_issues: 0,
    backlog_issues: 0,
  };
  if (opts.includeArchivedAt) dto.archived_at = c.archivedAt ? c.archivedAt.toISOString() : null;
  return dto;
}
