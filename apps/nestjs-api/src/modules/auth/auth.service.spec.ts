import { describe, it, expect } from "vitest";
import { AuthService } from "./auth.service";
import { makeDjangoPassword } from "../../infra/auth/django-password";
import type { Database } from "../../infra/database/drizzle.module";

// Minimal chainable db mock: select().from().where().limit() -> Promise<rows>.
function dbReturning(rows: unknown[]): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Database;
}

const password = "s3cret-password";
const user = {
  id: "u1",
  email: "Test@Example.com",
  password: makeDjangoPassword(password, { iterations: 1000, salt: "abcdefgh" }),
  isActive: true,
};

describe("AuthService.verifyCredentials", () => {
  it("returns the user for correct email/password (case-insensitive email)", async () => {
    const svc = new AuthService(dbReturning([user]));
    const result = await svc.verifyCredentials("test@example.com", password);
    expect(result?.id).toBe("u1");
  });

  it("returns null for a wrong password", async () => {
    const svc = new AuthService(dbReturning([user]));
    expect(await svc.verifyCredentials("test@example.com", "nope")).toBeNull();
  });

  it("returns null when no user is found", async () => {
    const svc = new AuthService(dbReturning([]));
    expect(await svc.verifyCredentials("missing@example.com", password)).toBeNull();
  });

  it("returns null when the user has no usable password", async () => {
    const svc = new AuthService(dbReturning([{ ...user, password: null }]));
    expect(await svc.verifyCredentials("test@example.com", password)).toBeNull();
  });
});
