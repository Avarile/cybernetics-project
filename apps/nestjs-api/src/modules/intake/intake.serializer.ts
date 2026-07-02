import type { IssueAnnotations } from "../issue/issue.repository";
import { serializeIssue, type IssueDTO } from "../issue/issue.serializer";
import type { Issue } from "../issue/issue.schema";
import type { Intake, IntakeIssue } from "./intake.schema";

// ---- ProjectLite (ProjectLiteSerializer) -----------------------------------
// Only the columns present in the NestJS `projects` schema are populated; cover_image /
// cover_image_url / logo_props are not yet ported to that table (see report notes).
export interface ProjectLiteDTO {
  id: string;
  identifier: string | null;
  name: string;
  cover_image: string | null;
  cover_image_url: string | null;
  logo_props: Record<string, unknown>;
  description: string | null;
}

export interface ProjectLiteInput {
  id: string;
  identifier: string | null;
  name: string;
  description: string | null;
}

export function serializeProjectLite(p: ProjectLiteInput): ProjectLiteDTO {
  return {
    id: p.id,
    identifier: p.identifier,
    name: p.name,
    cover_image: null,
    cover_image_url: null,
    logo_props: {},
    description: p.description,
  };
}

// ---- IssueIntakeSerializer (nested issue for the list serializer) -----------
export interface IssueIntakeDTO {
  id: string;
  name: string;
  priority: string | null;
  sequence_id: number | null;
  project_id: string;
  created_at: Date;
  label_ids: string[];
  created_by: string | null;
}

export function serializeIssueIntake(issue: Issue, labelIds: string[]): IssueIntakeDTO {
  return {
    id: issue.id,
    name: issue.name,
    priority: issue.priority,
    sequence_id: issue.sequenceId,
    project_id: issue.projectId,
    created_at: issue.createdAt,
    label_ids: labelIds,
    created_by: issue.createdBy,
  };
}

// ---- IssueDetailSerializer (nested issue for the detail serializer) ---------
export interface IssueDetailDTO extends IssueDTO {
  description_html: string | null;
  is_subscribed: boolean;
  is_intake: boolean;
}

export function serializeIssueDetail(issue: Issue, ann: IssueAnnotations): IssueDetailDTO {
  return {
    ...serializeIssue(issue, ann),
    description_html: issue.descriptionHtml,
    is_subscribed: false, // TODO(phase2): issue_subscribers
    is_intake: true,
  };
}

// ---- IntakeSerializer (Django fields="__all__" → bare FK names) -------------
export interface IntakeDTO {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean | null;
  view_props: Record<string, unknown> | null;
  logo_props: Record<string, unknown> | null;
  project: string;
  workspace: string;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: Date | null;
  project_detail: ProjectLiteDTO | null;
  pending_issue_count: number;
}

export function serializeIntake(
  intake: Intake,
  pendingIssueCount: number,
  projectDetail: ProjectLiteDTO | null,
): IntakeDTO {
  return {
    id: intake.id,
    name: intake.name,
    description: intake.description,
    is_default: intake.isDefault,
    view_props: intake.viewProps,
    logo_props: intake.logoProps,
    project: intake.projectId,
    workspace: intake.workspaceId,
    created_at: intake.createdAt,
    updated_at: intake.updatedAt,
    created_by: intake.createdBy,
    updated_by: intake.updatedBy,
    deleted_at: intake.deletedAt,
    project_detail: projectDetail,
    pending_issue_count: pendingIssueCount,
  };
}

// ---- IntakeIssueSerializer (list) ------------------------------------------
export interface IntakeIssueDTO {
  id: string;
  status: number | null;
  duplicate_to: string | null;
  snoozed_till: Date | null;
  source: string | null;
  issue: IssueIntakeDTO;
  created_by: string | null;
}

export function serializeIntakeIssue(ii: IntakeIssue, issue: Issue, labelIds: string[]): IntakeIssueDTO {
  return {
    id: ii.id,
    status: ii.status,
    duplicate_to: ii.duplicateToId,
    snoozed_till: ii.snoozedTill,
    source: ii.source,
    issue: serializeIssueIntake(issue, labelIds),
    created_by: ii.createdBy,
  };
}

// ---- IntakeIssueDetailSerializer (create / retrieve / update) ---------------
export interface IntakeIssueDetailDTO {
  id: string;
  status: number | null;
  duplicate_to: string | null;
  snoozed_till: Date | null;
  duplicate_issue_detail: IssueIntakeDTO | null;
  source: string | null;
  issue: IssueDetailDTO;
}

export function serializeIntakeIssueDetail(
  ii: IntakeIssue,
  issueDetail: IssueDetailDTO,
  duplicateIssueDetail: IssueIntakeDTO | null,
): IntakeIssueDetailDTO {
  return {
    id: ii.id,
    status: ii.status,
    duplicate_to: ii.duplicateToId,
    snoozed_till: ii.snoozedTill,
    duplicate_issue_detail: duplicateIssueDetail,
    source: ii.source,
    issue: issueDetail,
  };
}
