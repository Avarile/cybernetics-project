import type { State } from "./state.schema";

export interface StateDTO {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  color: string;
  group: string | null;
  default: boolean | null;
  description: string | null;
  sequence: number | null;
  order?: number;
}

// Mirrors StateSerializer fields (snake_case wire keys).
export function serializeState(s: State, order?: number): StateDTO {
  return {
    id: s.id,
    project_id: s.projectId,
    workspace_id: s.workspaceId,
    name: s.name,
    color: s.color,
    group: s.group,
    default: s.default,
    description: s.description,
    sequence: s.sequence,
    ...(order !== undefined ? { order } : {}),
  };
}
