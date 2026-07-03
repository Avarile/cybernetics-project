import { describe, expect, it } from "vitest";
import { buildIssueFilters } from "./issue-filters";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

describe("buildIssueFilters (issue_filters port)", () => {
  it("returns no conditions for empty params", () => {
    expect(buildIssueFilters({}, "GET")).toHaveLength(0);
  });

  it("emits a condition for priority (GET comma split)", () => {
    expect(buildIssueFilters({ priority: "high,urgent" }, "GET")).toHaveLength(1);
  });

  it("drops invalid uuids for state and emits nothing", () => {
    expect(buildIssueFilters({ state: "not-a-uuid" }, "GET")).toHaveLength(0);
  });

  it("keeps valid uuids for state", () => {
    expect(buildIssueFilters({ state: `${UUID_A},${UUID_B}` }, "GET")).toHaveLength(1);
  });

  it("sub_issue=false emits a parent IS NULL condition", () => {
    expect(buildIssueFilters({ sub_issue: "false" }, "GET")).toHaveLength(1);
    expect(buildIssueFilters({ sub_issue: "true" }, "GET")).toHaveLength(0);
  });

  it("type=active emits a state-group condition", () => {
    expect(buildIssueFilters({ type: "active" }, "GET")).toHaveLength(1);
  });

  it("labels 'None' + a valid uuid emit two conditions (NOT EXISTS + EXISTS)", () => {
    expect(buildIssueFilters({ labels: `None,${UUID_A}` }, "GET")).toHaveLength(2);
  });

  it("start_target_date=true emits both not-null conditions", () => {
    expect(buildIssueFilters({ start_target_date: "true" }, "GET")).toHaveLength(2);
  });

  it("POST mode accepts arrays directly", () => {
    expect(buildIssueFilters({ assignees: [UUID_A, UUID_B] }, "POST")).toHaveLength(1);
  });
});
