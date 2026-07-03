import { describe, expect, it } from "vitest";
import { baseFilters, getAnalyticsDateRange, getChartPeriodRange, issueObjects, parseProjectIds, projectFilters } from "./analytics-filters";

const scope = (projectIds: string[] = []) => ({ slug: "acme", userId: "u1", projectIds });

describe("analytics-filters", () => {
  it("parseProjectIds splits, trims and drops blanks", () => {
    expect(parseProjectIds("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(parseProjectIds("")).toEqual([]);
    expect(parseProjectIds(null)).toEqual([]);
  });

  it("date range helpers return null for empty/unknown filters", () => {
    expect(getAnalyticsDateRange(null)).toBeNull();
    expect(getAnalyticsDateRange("bogus")).toBeNull();
    expect(getChartPeriodRange(undefined)).toBeNull();
    expect(getChartPeriodRange("bogus")).toBeNull();
  });

  it("last_7_days chart range spans exactly 7 days ending today", () => {
    const r = getChartPeriodRange("last_7_days");
    expect(r).not.toBeNull();
    const [s, e] = r!.map((d) => Date.parse(`${d}T00:00:00Z`));
    expect((e - s) / 86_400_000).toBe(7);
  });

  it("last_7_days analytics range carries current + previous windows", () => {
    const r = getAnalyticsDateRange("last_7_days");
    expect(r?.current.gte).toBeInstanceOf(Date);
    expect(r?.current.lte).toBeInstanceOf(Date);
    expect(r?.previous).toBeDefined();
  });

  it("yesterday analytics range has no previous window", () => {
    expect(getAnalyticsDateRange("yesterday")?.previous).toBeUndefined();
  });

  it("base_filters adds a project_id IN clause only when project_ids is given", () => {
    expect(baseFilters("i", scope())).toHaveLength(3);
    expect(baseFilters("i", scope(["p1"]))).toHaveLength(4);
  });

  it("project_filters and issue_objects emit the expected predicate counts", () => {
    expect(projectFilters("p", scope())).toHaveLength(4);
    expect(projectFilters("p", scope(["p1", "p2"]))).toHaveLength(5);
    expect(issueObjects("i")).toHaveLength(5);
  });
});
