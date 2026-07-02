import type { Label } from "./label.schema";

export interface LabelDTO {
  id: string;
  parent: string | null;
  name: string;
  color: string | null;
  project_id: string | null;
  workspace_id: string;
  sort_order: number | null;
}

// Mirrors LabelSerializer fields.
export function serializeLabel(l: Label): LabelDTO {
  return {
    id: l.id,
    parent: l.parentId,
    name: l.name,
    color: l.color,
    project_id: l.projectId,
    workspace_id: l.workspaceId,
    sort_order: l.sortOrder,
  };
}
