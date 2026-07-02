import type { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

/** Cookie name selection matches the Django SessionMiddleware: admin cookie on /instances paths. */
export function sessionCookieName(req: Request): string {
  return req.path.includes("instances") ? "admin-session-id" : "session-id";
}

export function setSessionCookie(
  res: Response,
  name: string,
  value: string,
  maxAgeSec: number,
  config: ConfigService,
): void {
  const domain = config.get<string>("SESSION_COOKIE_DOMAIN") || undefined;
  const sameSite = (config.get<string>("SESSION_COOKIE_SAMESITE", "Lax") as "lax" | "strict" | "none") ?? "lax";
  const secure = config.get<string>("SESSION_COOKIE_SECURE", "0") === "1";
  res.cookie(name, value, {
    maxAge: maxAgeSec * 1000,
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: "/",
  });
}

export function clearSessionCookie(res: Response, name: string, config: ConfigService): void {
  const domain = config.get<string>("SESSION_COOKIE_DOMAIN") || undefined;
  res.clearCookie(name, { path: "/", domain });
}

export function buildDeviceInfo(req: Request): Record<string, unknown> {
  return {
    user_agent: req.headers["user-agent"] ?? "",
    ip_address: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "",
    domain: req.get("host") ?? "",
  };
}
