import { describe, it, expect } from "vitest";
import { cronNext } from "./cron";

const at = (iso: string) => new Date(iso);

describe("cronNext (UTC)", () => {
  it("every 5 minutes", () => {
    expect(cronNext("*/5 * * * *", at("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-01T00:05:00.000Z");
    expect(cronNext("*/5 * * * *", at("2026-01-01T00:03:00Z")).toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("daily at 01:00 rolls to next day when past", () => {
    expect(cronNext("0 1 * * *", at("2026-01-01T00:30:00Z")).toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(cronNext("0 1 * * *", at("2026-01-01T02:00:00Z")).toISOString()).toBe("2026-01-02T01:00:00.000Z");
  });

  it("daily midnight", () => {
    expect(cronNext("0 0 * * *", at("2026-01-01T12:00:00Z")).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("minute+hour fixed (30 1 * * *)", () => {
    expect(cronNext("30 1 * * *", at("2026-01-01T01:00:00Z")).toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });

  it("every 6 hours (0 */6 * * *)", () => {
    expect(cronNext("0 */6 * * *", at("2026-01-01T05:00:00Z")).toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect(cronNext("0 */6 * * *", at("2026-01-01T18:30:00Z")).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("day-of-week (Mondays at 09:00)", () => {
    // 2026-01-05 is a Monday
    expect(cronNext("0 9 * * 1", at("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("throws on malformed expression", () => {
    expect(() => cronNext("bad", new Date())).toThrow();
  });
});
