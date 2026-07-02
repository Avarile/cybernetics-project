import { type ActivityCtx, type Dict, inverseRelation, isValidUuid, parseJson, pick, push, s, uuidOrNull } from "./activity.util";

/**
 * Port of the non-issue ACTIVITY_MAPPER handlers from plane/bgtasks/issue_activities_task.py:
 * comment / cycle / module / link / attachment / relation / reaction / vote / draft / intake.
 * These receive the RAW requested_data / current_instance and parse internally (like Django).
 */

// ---- comments -----------------------------------------------------------------------------------

export function createCommentActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  push(ctx, {
    verb: "created",
    field: "comment",
    comment: "created a comment",
    newValue: s(pick(requested, "comment_html")) ?? "",
    newIdentifier: uuidOrNull(pick(requested, "id")),
    issueCommentId: uuidOrNull(pick(requested, "id")),
  });
}

export function updateCommentActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  if (pick(current, "comment_html") === pick(requested, "comment_html")) return;
  push(ctx, {
    verb: "updated",
    field: "comment",
    comment: "updated a comment",
    oldValue: s(pick(current, "comment_html")) ?? "",
    oldIdentifier: uuidOrNull(pick(current, "id")),
    newValue: s(pick(requested, "comment_html")) ?? "",
    newIdentifier: uuidOrNull(pick(current, "id")),
    issueCommentId: uuidOrNull(pick(current, "id")),
  });
}

export function deleteCommentActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  push(ctx, {
    verb: "deleted",
    field: "comment",
    comment: "deleted the comment",
    issueCommentId: uuidOrNull(pick(requested, "comment_id")),
  });
}

// ---- cycles -------------------------------------------------------------------------------------

export async function createCycleIssueActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): Promise<void> {
  const current = parseJson(currentRaw);
  const updatedRecords = Array.isArray(pick(current, "updated_cycle_issues"))
    ? (pick(current, "updated_cycle_issues") as Dict[])
    : [];
  const createdRaw = pick(current, "created_cycle_issues");
  const createdRecords: Dict[] = Array.isArray(createdRaw)
    ? (createdRaw as Dict[])
    : ((parseJson(createdRaw) as unknown as Dict[]) ?? []);

  for (const rec of updatedRecords) {
    const oldCycle = isValidUuid(pick(rec, "old_cycle_id")) ? await ctx.repo.getCycle(pick(rec, "old_cycle_id") as string) : null;
    const newCycle = isValidUuid(pick(rec, "new_cycle_id")) ? await ctx.repo.getCycle(pick(rec, "new_cycle_id") as string) : null;
    const recIssue = uuidOrNull(pick(rec, "issue_id"));
    if (recIssue) await ctx.repo.touchIssue(recIssue);
    push(ctx, {
      issueId: recIssue,
      verb: "updated",
      field: "cycles",
      comment: `updated cycle from ${oldCycle ? oldCycle.name : ""} to ${newCycle ? newCycle.name : ""}`,
      oldValue: oldCycle ? oldCycle.name : "",
      newValue: newCycle ? newCycle.name : "",
      oldIdentifier: oldCycle ? oldCycle.id : null,
      newIdentifier: newCycle ? newCycle.id : null,
    });
  }
  for (const rec of createdRecords) {
    const fields = (pick(rec, "fields") as Dict | null) ?? {};
    const cycle = isValidUuid(pick(fields, "cycle")) ? await ctx.repo.getCycle(pick(fields, "cycle") as string) : null;
    const recIssue = uuidOrNull(pick(fields, "issue"));
    if (recIssue) await ctx.repo.touchIssue(recIssue);
    push(ctx, {
      issueId: recIssue,
      verb: "created",
      field: "cycles",
      comment: `added cycle ${cycle ? cycle.name : ""}`,
      oldValue: "",
      newValue: cycle ? cycle.name : "",
      newIdentifier: cycle ? cycle.id : null,
    });
  }
}

export async function deleteCycleIssueActivity(ctx: ActivityCtx, requestedRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const cycleId = pick(requested, "cycle_id");
  const cycleName = s(pick(requested, "cycle_name")) ?? "";
  const cycle = isValidUuid(cycleId) ? await ctx.repo.getCycle(cycleId) : null;
  const issueIds = Array.isArray(pick(requested, "issues")) ? (pick(requested, "issues") as unknown[]) : [];
  for (const issue of issueIds) {
    const iid = uuidOrNull(issue);
    if (iid) await ctx.repo.touchIssue(iid);
    push(ctx, {
      issueId: iid,
      verb: "deleted",
      field: "cycles",
      comment: `removed this issue from ${cycle ? cycle.name : cycleName}`,
      oldValue: cycle ? cycle.name : cycleName,
      newValue: "",
      oldIdentifier: uuidOrNull(cycleId),
    });
  }
}

// ---- modules ------------------------------------------------------------------------------------

export async function createModuleIssueActivity(ctx: ActivityCtx, requestedRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const module = isValidUuid(pick(requested, "module_id")) ? await ctx.repo.getModule(pick(requested, "module_id") as string) : null;
  if (ctx.base.issueId) await ctx.repo.touchIssue(ctx.base.issueId);
  push(ctx, {
    verb: "created",
    field: "modules",
    comment: `added module ${module ? module.name : ""}`,
    oldValue: "",
    newValue: module ? module.name : "",
    newIdentifier: uuidOrNull(pick(requested, "module_id")),
  });
}

export async function deleteModuleIssueActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  const moduleName = s(pick(current, "module_name"));
  if (ctx.base.issueId) await ctx.repo.touchIssue(ctx.base.issueId);
  push(ctx, {
    verb: "deleted",
    field: "modules",
    comment: `removed this issue from ${moduleName ?? ""}`,
    oldValue: moduleName,
    newValue: "",
    oldIdentifier: uuidOrNull(pick(requested, "module_id")),
  });
}

// ---- links --------------------------------------------------------------------------------------

export function createLinkActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  push(ctx, {
    verb: "created",
    field: "link",
    comment: "created a link",
    newValue: s(pick(requested, "url")) ?? "",
    newIdentifier: uuidOrNull(pick(requested, "id")),
  });
}

export function updateLinkActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  if (pick(current, "url") === pick(requested, "url")) return;
  push(ctx, {
    verb: "updated",
    field: "link",
    comment: "updated a link",
    oldValue: s(pick(current, "url")) ?? "",
    oldIdentifier: uuidOrNull(pick(current, "id")),
    newValue: s(pick(requested, "url")) ?? "",
    newIdentifier: uuidOrNull(pick(current, "id")),
  });
}

export function deleteLinkActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): void {
  const current = parseJson(currentRaw);
  push(ctx, {
    verb: "deleted",
    field: "link",
    comment: "deleted the link",
    oldValue: s(pick(current, "url")) ?? "",
    newValue: "",
  });
}

// ---- attachments --------------------------------------------------------------------------------

export function createAttachmentActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): void {
  const current = parseJson(currentRaw);
  push(ctx, {
    verb: "created",
    field: "attachment",
    comment: "created an attachment",
    newValue: s(pick(current, "asset")) ?? "",
    newIdentifier: uuidOrNull(pick(current, "id")),
  });
}

export function deleteAttachmentActivity(ctx: ActivityCtx): void {
  push(ctx, { verb: "deleted", field: "attachment", comment: "deleted the attachment" });
}

// ---- issue relations ----------------------------------------------------------------------------

export async function createIssueRelationActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  if (current !== null || !requested || !Array.isArray(pick(requested, "issues"))) return;
  const relationType = String(pick(requested, "relation_type"));
  for (const related of pick(requested, "issues") as unknown[]) {
    const relatedId = uuidOrNull(related);
    const relatedRef = isValidUuid(related) ? await ctx.repo.issueRef(related) : null;
    push(ctx, {
      verb: "updated",
      field: relationType,
      comment: `added ${relationType} relation`,
      oldValue: "",
      newValue: relatedRef ? relatedRef.ref : "",
      oldIdentifier: relatedId,
    });
    const inverse = inverseRelation(relationType);
    const mainRef = ctx.base.issueId ? await ctx.repo.issueRef(ctx.base.issueId) : null;
    push(ctx, {
      issueId: relatedId,
      verb: "updated",
      field: inverse,
      comment: `added ${inverse} relation`,
      oldValue: "",
      newValue: mainRef ? mainRef.ref : "",
      oldIdentifier: uuidOrNull(ctx.base.issueId),
    });
  }
}

export async function deleteIssueRelationActivity(ctx: ActivityCtx, requestedRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const related = pick(requested, "related_issue");
  const relationType = String(pick(requested, "relation_type"));
  const relatedRef = isValidUuid(related) ? await ctx.repo.issueRef(related) : null;
  push(ctx, {
    verb: "deleted",
    field: relationType,
    comment: `deleted ${relationType} relation`,
    oldValue: relatedRef ? relatedRef.ref : "",
    newValue: "",
    oldIdentifier: uuidOrNull(related),
  });
  const mainRef = ctx.base.issueId ? await ctx.repo.issueRef(ctx.base.issueId) : null;
  const inverseField =
    relationType === "blocked_by" ? "blocking" : relationType === "blocking" ? "blocked_by" : relationType;
  push(ctx, {
    issueId: uuidOrNull(related),
    verb: "deleted",
    field: inverseField,
    comment: `deleted ${relationType} relation`,
    oldValue: mainRef ? mainRef.ref : "",
    newValue: "",
    oldIdentifier: uuidOrNull(related),
  });
}

// ---- reactions (partial — see TODO(phase3)) -----------------------------------------------------

export function createIssueReactionActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  if (!requested || pick(requested, "reaction") === null) return;
  // TODO(phase3): Django looks up IssueReaction(reaction, project, actor) to set new_identifier and
  // only writes when found. issue_reactions isn't ported yet, so write the row without the id.
  push(ctx, {
    verb: "created",
    field: "reaction",
    comment: "added the reaction",
    oldValue: null,
    newValue: s(pick(requested, "reaction")),
    oldIdentifier: null,
    newIdentifier: null,
  });
}

export function deleteIssueReactionActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): void {
  const current = parseJson(currentRaw);
  if (!current || pick(current, "reaction") === null) return;
  push(ctx, {
    verb: "deleted",
    field: "reaction",
    comment: "removed the reaction",
    oldValue: s(pick(current, "reaction")),
    newValue: null,
    oldIdentifier: uuidOrNull(pick(current, "identifier")),
    newIdentifier: null,
  });
}

export function createCommentReactionActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  if (!requested || pick(requested, "reaction") === null) return;
  // TODO(phase3): needs CommentReaction + IssueComment lookups (to resolve issue_id + new_identifier).
  push(ctx, {
    verb: "created",
    field: "reaction",
    comment: "added the reaction",
    oldValue: null,
    newValue: s(pick(requested, "reaction")),
  });
}

export function deleteCommentReactionActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): void {
  const current = parseJson(currentRaw);
  if (!current || pick(current, "reaction") === null) return;
  // TODO(phase3): needs IssueComment lookup to resolve issue_id from comment_id.
  push(ctx, {
    verb: "deleted",
    field: "reaction",
    comment: "removed the reaction",
    oldValue: s(pick(current, "reaction")),
    newValue: null,
    oldIdentifier: uuidOrNull(pick(current, "identifier")),
  });
}

// ---- votes --------------------------------------------------------------------------------------

export function createIssueVoteActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  if (!requested || pick(requested, "vote") === null) return;
  push(ctx, {
    verb: "updated",
    field: "vote",
    comment: "added the vote",
    oldValue: null,
    newValue: s(pick(requested, "vote")),
  });
}

export function deleteIssueVoteActivity(ctx: ActivityCtx, _r: unknown, currentRaw: unknown): void {
  const current = parseJson(currentRaw);
  if (!current || pick(current, "vote") === null) return;
  push(ctx, {
    verb: "deleted",
    field: "vote",
    comment: "removed the vote",
    oldValue: s(pick(current, "vote")),
    newValue: null,
    oldIdentifier: uuidOrNull(pick(current, "identifier")),
  });
}

// ---- draft issues -------------------------------------------------------------------------------

export function createDraftIssueActivity(ctx: ActivityCtx): void {
  push(ctx, { verb: "created", field: "draft", comment: "drafted the issue" });
}

export function updateDraftIssueActivity(ctx: ActivityCtx, requestedRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  if (pick(requested, "is_draft") !== null && pick(requested, "is_draft") === false) {
    push(ctx, { verb: "updated", comment: "created the issue" });
  } else {
    push(ctx, { verb: "updated", field: "draft", comment: "updated the draft issue" });
  }
}

export function deleteDraftIssueActivity(ctx: ActivityCtx): void {
  // Django omits issue_id for the draft-delete row.
  push(ctx, { issueId: null, verb: "deleted", field: "draft", comment: "deleted the draft issue" });
}

// ---- intake -------------------------------------------------------------------------------------

const INTAKE_STATUS: Record<string, string> = {
  "-2": "Pending",
  "-1": "Rejected",
  "0": "Snoozed",
  "1": "Accepted",
  "2": "Duplicate",
};

export function createIntakeActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): void {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  if (pick(requested, "status") === null) return;
  push(ctx, {
    verb: s(pick(requested, "status")) ?? "updated",
    field: "intake",
    comment: "updated the intake status",
    oldValue: INTAKE_STATUS[String(pick(current, "status"))] ?? null,
    newValue: INTAKE_STATUS[String(pick(requested, "status"))] ?? null,
  });
}
