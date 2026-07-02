import type { Estimate, EstimatePoint } from "./estimate.schema";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// Mirrors EstimatePointSerializer (fields = "__all__"). Foreign keys serialize to their PK under the
// model field name (estimate / project / workspace), matching DRF's PrimaryKeyRelatedField.
export interface EstimatePointDTO {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  key: number | null;
  description: string | null;
  value: string;
  estimate: string;
  project: string;
  workspace: string;
}

// Mirrors EstimateReadSerializer (fields = "__all__", with nested `points`).
export interface EstimateDTO {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  name: string;
  description: string | null;
  type: string | null;
  last_used: boolean | null;
  project: string;
  workspace: string;
  points?: EstimatePointDTO[];
}

export function serializeEstimatePoint(p: EstimatePoint): EstimatePointDTO {
  return {
    id: p.id,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
    created_by: p.createdBy,
    updated_by: p.updatedBy,
    deleted_at: iso(p.deletedAt),
    key: p.key,
    description: p.description,
    value: p.value,
    estimate: p.estimateId,
    project: p.projectId,
    workspace: p.workspaceId,
  };
}

export function serializeEstimate(e: Estimate, points?: EstimatePoint[]): EstimateDTO {
  const dto: EstimateDTO = {
    id: e.id,
    created_at: iso(e.createdAt),
    updated_at: iso(e.updatedAt),
    created_by: e.createdBy,
    updated_by: e.updatedBy,
    deleted_at: iso(e.deletedAt),
    name: e.name,
    description: e.description,
    type: e.type,
    last_used: e.lastUsed,
    project: e.projectId,
    workspace: e.workspaceId,
  };
  if (points !== undefined) dto.points = points.map(serializeEstimatePoint);
  return dto;
}
