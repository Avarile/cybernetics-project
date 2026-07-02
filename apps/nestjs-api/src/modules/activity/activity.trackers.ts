import { type ActivityCtx, type Dict, extractIds, isValidUuid, parseJson, pick, push, s, uuidOrNull } from "./activity.util";

/**
 * Port of create_issue_activity / update_issue_activity / delete_issue_activity and the 12 track_*
 * handlers (ISSUE_ACTIVITY_MAPPER) from plane/bgtasks/issue_activities_task.py. track_* receive
 * ALREADY-PARSED dicts (update_issue_activity parses first, exactly like Django).
 */

// ---- 12 track_* handlers ------------------------------------------------------------------------

function trackName(ctx: ActivityCtx, requested: Dict, current: Dict): void {
  if (pick(current, "name") === pick(requested, "name")) return;
  push(ctx, {
    verb: "updated",
    field: "name",
    comment: "updated the name to",
    oldValue: s(pick(current, "name")),
    newValue: s(pick(requested, "name")),
  });
}

async function trackDescription(ctx: ActivityCtx, requested: Dict, current: Dict): Promise<void> {
  if (pick(current, "description_html") === pick(requested, "description_html")) return;
  // Coalesce consecutive description edits by the same actor into the previous row's timestamp.
  if (ctx.base.issueId) {
    const last = await ctx.repo.lastActivity(ctx.base.issueId);
    if (last && last.field === "description" && ctx.base.actorId === s(last.actorId)) {
      await ctx.repo.touchActivityCreatedAt(last.id);
      return;
    }
  }
  push(ctx, {
    verb: "updated",
    field: "description",
    comment: "updated the description to",
    oldValue: s(pick(current, "description_html")),
    newValue: s(pick(requested, "description_html")),
  });
}

async function trackParent(ctx: ActivityCtx, requested: Dict, current: Dict): Promise<void> {
  const currentParent = pick(current, "parent_id") ?? pick(current, "parent");
  const requestedParent = pick(requested, "parent_id") ?? pick(requested, "parent");
  if (currentParent !== null && !isValidUuid(currentParent)) return;
  if (requestedParent !== null && !isValidUuid(requestedParent)) return;
  if (currentParent === requestedParent) return;

  const oldParent = isValidUuid(currentParent) ? await ctx.repo.issueRef(currentParent) : null;
  const newParent = isValidUuid(requestedParent) ? await ctx.repo.issueRef(requestedParent) : null;
  push(ctx, {
    verb: "updated",
    field: "parent",
    comment: "updated the parent issue to",
    oldValue: oldParent ? oldParent.ref : "",
    newValue: newParent ? newParent.ref : "",
    oldIdentifier: oldParent ? oldParent.id : null,
    newIdentifier: newParent ? newParent.id : null,
  });
}

function trackPriority(ctx: ActivityCtx, requested: Dict, current: Dict): void {
  if (pick(current, "priority") === pick(requested, "priority")) return;
  push(ctx, {
    verb: "updated",
    field: "priority",
    comment: "updated the priority to",
    oldValue: s(pick(current, "priority")),
    newValue: s(pick(requested, "priority")),
  });
}

async function trackState(ctx: ActivityCtx, requested: Dict, current: Dict): Promise<void> {
  let currentState = pick(current, "state_id") ?? pick(current, "state");
  let requestedState = pick(requested, "state_id") ?? pick(requested, "state");
  if (currentState !== null && !isValidUuid(currentState)) currentState = null;
  if (requestedState !== null && !isValidUuid(requestedState)) requestedState = null;
  if (currentState === requestedState) return;

  const oldState = isValidUuid(currentState) ? await ctx.repo.getState(ctx.base.projectId, currentState) : null;
  const newState = isValidUuid(requestedState) ? await ctx.repo.getState(ctx.base.projectId, requestedState) : null;
  push(ctx, {
    verb: "updated",
    field: "state",
    comment: "updated the state to",
    oldValue: oldState ? oldState.name : null,
    newValue: newState ? newState.name : null,
    oldIdentifier: oldState ? oldState.id : null,
    newIdentifier: newState ? newState.id : null,
  });
}

function trackTargetDate(ctx: ActivityCtx, requested: Dict, current: Dict): void {
  if (pick(current, "target_date") === pick(requested, "target_date")) return;
  push(ctx, {
    verb: "updated",
    field: "target_date",
    comment: "updated the target date to",
    oldValue: pick(current, "target_date") !== null ? s(pick(current, "target_date")) : "",
    newValue: pick(requested, "target_date") !== null ? s(pick(requested, "target_date")) : "",
  });
}

function trackStartDate(ctx: ActivityCtx, requested: Dict, current: Dict): void {
  if (pick(current, "start_date") === pick(requested, "start_date")) return;
  push(ctx, {
    verb: "updated",
    field: "start_date",
    comment: "updated the start date to ",
    oldValue: pick(current, "start_date") !== null ? s(pick(current, "start_date")) : "",
    newValue: pick(requested, "start_date") !== null ? s(pick(requested, "start_date")) : "",
  });
}

async function trackLabels(ctx: ActivityCtx, requested: Dict, current: Dict): Promise<void> {
  const requestedLabels = extractIds(requested, "label_ids", "labels");
  const currentLabels = extractIds(current, "label_ids", "labels");
  const added = [...requestedLabels].filter((x) => !currentLabels.has(x));
  const dropped = [...currentLabels].filter((x) => !requestedLabels.has(x));

  for (const id of added) {
    if (!isValidUuid(id)) continue;
    const label = await ctx.repo.getLabel(id);
    push(ctx, {
      verb: "updated",
      field: "labels",
      comment: "added label ",
      oldValue: "",
      newValue: label ? label.name : "",
      oldIdentifier: null,
      newIdentifier: label ? label.id : null,
    });
  }
  for (const id of dropped) {
    if (!isValidUuid(id)) continue;
    const label = await ctx.repo.getLabel(id);
    push(ctx, {
      verb: "updated",
      field: "labels",
      comment: "removed label ",
      oldValue: label ? label.name : "",
      newValue: "",
      oldIdentifier: label ? label.id : null,
      newIdentifier: null,
    });
  }
}

export async function trackAssignees(ctx: ActivityCtx, requested: Dict, current: Dict | null): Promise<void> {
  const requestedAssignees = extractIds(requested, "assignee_ids", "assignees");
  const currentAssignees = extractIds(current, "assignee_ids", "assignees");
  const added = [...requestedAssignees].filter((x) => !currentAssignees.has(x));
  const dropped = [...currentAssignees].filter((x) => !requestedAssignees.has(x));

  for (const id of added) {
    if (!isValidUuid(id)) continue;
    const assignee = await ctx.repo.getUser(id);
    push(ctx, {
      verb: "updated",
      field: "assignees",
      comment: "added assignee ",
      oldValue: "",
      newValue: assignee ? assignee.displayName : null,
      newIdentifier: assignee ? assignee.id : null,
    });
    // TODO(phase3): also IssueSubscriber.bulk_create(subscriber=assignee) once issue_subscribers is ported.
  }
  for (const id of dropped) {
    if (!isValidUuid(id)) continue;
    const assignee = await ctx.repo.getUser(id);
    push(ctx, {
      verb: "updated",
      field: "assignees",
      comment: "removed assignee ",
      oldValue: assignee ? assignee.displayName : null,
      newValue: "",
      oldIdentifier: assignee ? assignee.id : null,
    });
  }
}

async function trackEstimatePoints(ctx: ActivityCtx, requested: Dict, current: Dict): Promise<void> {
  if (pick(current, "estimate_point") === pick(requested, "estimate_point")) return;
  const currentId = pick(current, "estimate_point");
  const requestedId = pick(requested, "estimate_point");
  const oldEstimate = isValidUuid(currentId) ? await ctx.repo.getEstimatePoint(currentId) : null;
  const newEstimate = isValidUuid(requestedId) ? await ctx.repo.getEstimatePoint(requestedId) : null;
  push(ctx, {
    verb: newEstimate === null ? "removed" : "updated",
    // Django uses "estimate_" + new_estimate.estimate.type; guard the removal case (new is null).
    field: newEstimate ? `estimate_${newEstimate.type}` : "estimate_points",
    comment: "updated the estimate point to ",
    oldValue: oldEstimate ? oldEstimate.value : null,
    newValue: newEstimate ? newEstimate.value : null,
    oldIdentifier: uuidOrNull(currentId),
    newIdentifier: uuidOrNull(requestedId),
  });
}

function trackArchiveAt(ctx: ActivityCtx, requested: Dict, current: Dict): void {
  if (pick(current, "archived_at") === pick(requested, "archived_at")) return;
  if (pick(requested, "archived_at") === null) {
    push(ctx, {
      verb: "updated",
      field: "archived_at",
      comment: "has restored the issue",
      oldValue: "archive",
      newValue: "restore",
    });
    return;
  }
  const automation = Boolean(pick(requested, "automation"));
  push(ctx, {
    verb: "updated",
    field: "archived_at",
    comment: automation ? "Plane has archived the issue" : "Actor has archived the issue",
    oldValue: null,
    newValue: automation ? "archive" : "manual_archive",
  });
}

async function trackClosedTo(ctx: ActivityCtx, requested: Dict, _current: Dict): Promise<void> {
  const closedTo = pick(requested, "closed_to");
  if (closedTo === null) return;
  const state = isValidUuid(closedTo) ? await ctx.repo.getState(ctx.base.projectId, closedTo) : null;
  push(ctx, {
    verb: "updated",
    field: "state",
    comment: "Plane updated the state to ",
    oldValue: null,
    newValue: state ? state.name : null,
    oldIdentifier: null,
    newIdentifier: state ? state.id : null,
  });
}

// key -> track_* (mirrors ISSUE_ACTIVITY_MAPPER, incl. external-endpoint aliases).
const TRACK_MAPPER: Record<string, (ctx: ActivityCtx, requested: Dict, current: Dict) => void | Promise<void>> = {
  name: trackName,
  parent_id: trackParent,
  priority: trackPriority,
  state_id: trackState,
  description_html: trackDescription,
  target_date: trackTargetDate,
  start_date: trackStartDate,
  label_ids: trackLabels,
  assignee_ids: trackAssignees,
  estimate_point: trackEstimatePoints,
  archived_at: trackArchiveAt,
  closed_to: trackClosedTo,
  // External endpoint keys.
  parent: trackParent,
  state: trackState,
  assignees: trackAssignees,
  labels: trackLabels,
};

// ---- create / update / delete issue -------------------------------------------------------------

export async function createIssueActivity(ctx: ActivityCtx, requestedRaw: unknown): Promise<void> {
  if (!ctx.base.issueId) return;
  const issue = await ctx.repo.getIssue(ctx.base.issueId);
  // IssueActivity.objects.create(...) then override created_at/actor from the issue. This standalone
  // row is NOT part of ctx.rows (so it is excluded from the notifications payload, as in Django).
  await ctx.repo.insertOne({
    issueId: ctx.base.issueId,
    projectId: ctx.base.projectId,
    workspaceId: ctx.base.workspaceId,
    comment: "created the issue",
    verb: "created",
    actorId: issue ? issue.createdBy : ctx.base.actorId,
    epoch: ctx.base.epoch,
    ...(issue ? { createdAt: issue.createdAt } : {}),
  });
  const requested = parseJson(requestedRaw);
  if (requested && pick(requested, "assignee_ids") !== null) {
    await trackAssignees(ctx, requested, null);
  }
}

export async function updateIssueActivity(ctx: ActivityCtx, requestedRaw: unknown, currentRaw: unknown): Promise<void> {
  const requested = parseJson(requestedRaw);
  const current = parseJson(currentRaw);
  if (!requested) return;
  for (const key of Object.keys(requested)) {
    const fn = TRACK_MAPPER[key];
    if (fn) await fn(ctx, requested, current ?? {});
  }
}

export function deleteIssueActivity(ctx: ActivityCtx): void {
  push(ctx, { verb: "deleted", field: "issue", comment: "deleted the issue" });
}
