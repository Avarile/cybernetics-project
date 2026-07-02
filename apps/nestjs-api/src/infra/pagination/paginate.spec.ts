import { describe, it, expect } from "vitest";
import { paginate, parseCursor } from "./paginate";

describe("parseCursor", () => {
  it("defaults to page 0 with the default per-page", () => {
    expect(parseCursor({})).toEqual({ page: 0, limit: 1000 });
  });
  it("parses a cursor string", () => {
    expect(parseCursor({ cursor: "50:2:0" })).toEqual({ page: 2, limit: 50 });
  });
  it("caps per_page at maxPerPage", () => {
    expect(parseCursor({ perPage: 99999, defaultPerPage: 100, maxPerPage: 100 })).toEqual({ page: 0, limit: 100 });
  });
});

describe("paginate", () => {
  it("produces the BasePaginator envelope and detects next page", async () => {
    const all = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const res = await paginate(
      { perPage: 10 },
      async () => all.length,
      async ({ offset, limitPlusOne }) => all.slice(offset, offset + limitPlusOne),
    );
    expect(res.results).toHaveLength(10);
    expect(res.next_page_results).toBe(true);
    expect(res.prev_page_results).toBe(false);
    expect(res.next_cursor).toBe("10:1:0");
    expect(res.prev_cursor).toBe("10:-1:1");
    expect(res.total_count).toBe(25);
    expect(res.total_pages).toBe(3);
    expect(res.count).toBe(10);
  });

  it("marks the last page as having no next results", async () => {
    const all = Array.from({ length: 15 }, (_, i) => ({ id: i }));
    const res = await paginate(
      { cursor: "10:1:0" },
      async () => all.length,
      async ({ offset, limitPlusOne }) => all.slice(offset, offset + limitPlusOne),
    );
    expect(res.results).toHaveLength(5);
    expect(res.next_page_results).toBe(false);
    expect(res.prev_page_results).toBe(true);
  });

  it("applies onResults transform", async () => {
    const res = await paginate(
      { perPage: 5 },
      async () => 2,
      async () => [{ id: 1 }, { id: 2 }],
      (rows) => rows.map((r) => ({ id: r.id * 10 })),
    );
    expect(res.results).toEqual([{ id: 10 }, { id: 20 }]);
  });
});
