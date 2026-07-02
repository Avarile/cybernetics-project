import type { IssueAnnotations } from "./issue.repository";
import type { Issue } from "./issue.schema";

// Mirrors IssueSerializer fields (plane/app/serializers/issue.py). snake_case wire keys.
export interface IssueDTO {
  id: string;
  name: string;
  state_id: string | null;
  sort_order: number | null;
  completed_at: Date | null;
  estimate_point: string | null;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  sequence_id: number | null;
  project_id: string;
  parent_id: string | null;
  cycle_id: string | null;
  module_ids: string[];
  label_ids: string[];
  assignee_ids: string[];
  sub_issues_count: number;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  attachment_count: number;
  link_count: number;
  is_draft: boolean | null;
  archived_at: string | null;
}

export function serializeIssue(issue: Issue, ann: IssueAnnotations): IssueDTO {
  return {
    id: issue.id,
    name: issue.name,
    state_id: issue.stateId,
    sort_order: issue.sortOrder,
    completed_at: issue.completedAt,
    estimate_point: issue.estimatePointId,
    priority: issue.priority,
    start_date: issue.startDate,
    target_date: issue.targetDate,
    sequence_id: issue.sequenceId,
    project_id: issue.projectId,
    parent_id: issue.parentId,
    cycle_id: ann.cycle_id,
    module_ids: ann.module_ids,
    label_ids: ann.label_ids,
    assignee_ids: ann.assignee_ids,
    sub_issues_count: ann.sub_issues_count,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    created_by: issue.createdBy,
    updated_by: issue.updatedBy,
    attachment_count: ann.attachment_count,
    link_count: ann.link_count,
    is_draft: issue.isDraft,
    archived_at: issue.archivedAt,
  };
}
