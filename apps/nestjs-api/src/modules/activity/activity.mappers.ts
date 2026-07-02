import {
  createAttachmentActivity,
  createCommentActivity,
  createCommentReactionActivity,
  createCycleIssueActivity,
  createDraftIssueActivity,
  createIntakeActivity,
  createIssueReactionActivity,
  createIssueRelationActivity,
  createIssueVoteActivity,
  createLinkActivity,
  createModuleIssueActivity,
  deleteAttachmentActivity,
  deleteCommentActivity,
  deleteCommentReactionActivity,
  deleteCycleIssueActivity,
  deleteDraftIssueActivity,
  deleteIssueReactionActivity,
  deleteIssueRelationActivity,
  deleteIssueVoteActivity,
  deleteLinkActivity,
  deleteModuleIssueActivity,
  updateCommentActivity,
  updateDraftIssueActivity,
  updateLinkActivity,
} from "./activity.entity-mappers";
import { createIssueActivity, deleteIssueActivity, updateIssueActivity } from "./activity.trackers";
import type { ActivityCtx } from "./activity.util";

// Re-export so consumers (the handler) have a single mapper entry point.
export { type ActivityCtx, type BaseFields, isValidUuid } from "./activity.util";

type Mapper = (ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown) => void | Promise<void>;

/** ACTIVITY_MAPPER — the type -> handler routing table from issue_activity(). */
export const ACTIVITY_MAPPER: Record<string, Mapper> = {
  "issue.activity.created": (ctx, req) => createIssueActivity(ctx, req),
  "issue.activity.updated": updateIssueActivity,
  "issue.activity.deleted": (ctx) => deleteIssueActivity(ctx),
  "comment.activity.created": (ctx, req) => createCommentActivity(ctx, req),
  "comment.activity.updated": updateCommentActivity,
  "comment.activity.deleted": (ctx, req) => deleteCommentActivity(ctx, req),
  "cycle.activity.created": createCycleIssueActivity,
  "cycle.activity.deleted": (ctx, req) => deleteCycleIssueActivity(ctx, req),
  "module.activity.created": (ctx, req) => createModuleIssueActivity(ctx, req),
  "module.activity.deleted": deleteModuleIssueActivity,
  "link.activity.created": (ctx, req) => createLinkActivity(ctx, req),
  "link.activity.updated": updateLinkActivity,
  "link.activity.deleted": deleteLinkActivity,
  "attachment.activity.created": createAttachmentActivity,
  "attachment.activity.deleted": (ctx) => deleteAttachmentActivity(ctx),
  "issue_relation.activity.created": createIssueRelationActivity,
  "issue_relation.activity.deleted": (ctx, req) => deleteIssueRelationActivity(ctx, req),
  "issue_reaction.activity.created": (ctx, req) => createIssueReactionActivity(ctx, req),
  "issue_reaction.activity.deleted": deleteIssueReactionActivity,
  "comment_reaction.activity.created": (ctx, req) => createCommentReactionActivity(ctx, req),
  "comment_reaction.activity.deleted": deleteCommentReactionActivity,
  "issue_vote.activity.created": (ctx, req) => createIssueVoteActivity(ctx, req),
  "issue_vote.activity.deleted": deleteIssueVoteActivity,
  "issue_draft.activity.created": (ctx) => createDraftIssueActivity(ctx),
  "issue_draft.activity.updated": (ctx, req) => updateDraftIssueActivity(ctx, req),
  "issue_draft.activity.deleted": (ctx) => deleteDraftIssueActivity(ctx),
  "intake.activity.created": createIntakeActivity,
};

/** Run the mapper for a given activity type (no-op for unknown types, like Django's .get()). */
export async function dispatchActivity(
  type: string,
  ctx: ActivityCtx,
  requestedRaw: unknown,
  currentRaw: unknown,
): Promise<void> {
  const fn = ACTIVITY_MAPPER[type];
  if (fn) await fn(ctx, requestedRaw, currentRaw);
}
