import { describe, expect, it } from "vitest";
import { parseRateLimit } from "./auth-throttle";
describe("parseRateLimit", () => {
  it("parses '10/minute' to { limit:10, ttl:60000 }", () => {
    expect(parseRateLimit("10/minute")).toEqual({ limit: 10, ttl: 60000 });
  });
  it("falls back to 10/minute on garbage", () => {
    expect(parseRateLimit("nonsense")).toEqual({ limit: 10, ttl: 60000 });
  });
});
