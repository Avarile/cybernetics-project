import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "../../infra/database/drizzle.module";
import { buildAnalyticsChart } from "./build-chart";

// Fake db.execute so we exercise the row → response transformation without a real Postgres.
const fakeDb = (rows: Array<Record<string, unknown>>): Database => ({ execute: async () => ({ rows }) }) as unknown as Database;
const WHERE = [sql`i.deleted_at IS NULL`];

describe("buildAnalyticsChart", () => {
  it("simple chart maps falsy key/name to 'None'", async () => {
    const db = fakeDb([
      { key: null, display_name: null, count: 3 },
      { key: "high", display_name: "high", count: 2 },
    ]);
    const res = await buildAnalyticsChart(db, WHERE, "PRIORITY");
    expect(res.schema).toEqual({});
    expect(res.data).toEqual([
      { key: "None", name: "None", count: 3 },
      { key: "high", name: "high", count: 2 },
    ]);
  });

  it("estimate key 0 collapses to 'None' (numeric Python-falsy parity)", async () => {
    const res = await buildAnalyticsChart(fakeDb([{ key: 0, display_name: "0pt", count: 1 }]), WHERE, "ESTIMATE_POINTS");
    expect((res.data[0] as { key: string }).key).toBe("None");
  });

  it("grouped chart pivots group cells and builds the schema", async () => {
    const rows = [
      { key: "p1", group_key: "high", group_name: "high", display_name: "P1", count: 5 },
      { key: "p1", group_key: "low", group_name: "low", display_name: "P1", count: 2 },
      { key: "p2", group_key: "high", group_name: "high", display_name: "P2", count: 1 },
    ];
    const res = await buildAnalyticsChart(fakeDb(rows), WHERE, "STATES", "PRIORITY");
    expect(res.schema).toEqual({ high: "high", low: "low" });
    const p1 = (res.data as Array<Record<string, unknown>>).find((d) => d.key === "p1");
    expect(p1).toMatchObject({ key: "p1", name: "P1", count: 7, high: 5, low: 2 });
  });

  it("grouped chart uses 'none' for a falsy group_key and 'None' for a falsy group_name", async () => {
    const res = await buildAnalyticsChart(fakeDb([{ key: "p1", group_key: null, group_name: null, display_name: "P1", count: 4 }]), WHERE, "STATES", "PRIORITY");
    expect(res.schema).toEqual({ none: "None" });
    expect((res.data[0] as Record<string, unknown>).none).toBe(4);
  });

  it("rejects an invalid x_axis / group_by", async () => {
    await expect(buildAnalyticsChart(fakeDb([]), WHERE, "BOGUS")).rejects.toThrow(/Invalid x_axis/);
    await expect(buildAnalyticsChart(fakeDb([]), WHERE, "STATES", "BOGUS")).rejects.toThrow(/Invalid group_by/);
  });
});
