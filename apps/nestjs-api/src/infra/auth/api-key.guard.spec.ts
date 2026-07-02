import { describe, it, expect } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { ApiKeyGuard } from "./api-key.guard";
import type { Database } from "../database/drizzle.module";

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe("ApiKeyGuard", () => {
  it("rejects a missing X-Api-Key header", async () => {
    const guard = new ApiKeyGuard({} as Database);
    await expect(guard.canActivate(ctx({ headers: {} }))).rejects.toMatchObject({
      response: { detail: "Given API token is not valid" },
    });
  });

  it("rejects when the token is not found/active", async () => {
    // select().from().innerJoin().where().limit() -> []
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve([]),
    };
    const db = { select: () => chain } as unknown as Database;
    const guard = new ApiKeyGuard(db);
    await expect(guard.canActivate(ctx({ headers: { "x-api-key": "bad" } }))).rejects.toMatchObject({
      response: { detail: "Given API token is not valid" },
    });
  });
});
