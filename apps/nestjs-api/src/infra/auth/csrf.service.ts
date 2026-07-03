import { Injectable } from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { ConfigService } from "../config/config.service";

const COOKIE_NAME = "csrftoken";

/**
 * Django-style CSRF double-submit: a random token is set as a *readable* (non-httpOnly) cookie so
 * the frontend can echo it back on state-changing form-POSTs, either as the `csrfmiddlewaretoken`
 * body field or the `x-csrftoken` header. `validate` just compares cookie vs submitted value --
 * unlike Django's signed-token scheme, this is the plain double-submit variant.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly config: ConfigService) {}

  issue(res: Response): string {
    const token = randomBytes(32).toString("hex");
    const domain = this.config.get<string>("CSRF_COOKIE_DOMAIN") || undefined;
    const sameSite = (this.config.get<string>("CSRF_COOKIE_SAMESITE", "Lax") as "lax" | "strict" | "none") ?? "lax";
    const secure = this.config.get<string>("CSRF_COOKIE_SECURE", "0") === "1";
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,
      secure,
      sameSite,
      domain,
      path: "/",
    });
    return token;
  }

  validate(req: Request): boolean {
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const submitted = (req.body as Record<string, unknown> | undefined)?.["csrfmiddlewaretoken"] ?? req.headers["x-csrftoken"];
    if (typeof cookieToken !== "string" || typeof submitted !== "string" || !cookieToken || !submitted) {
      return false;
    }

    const a = Buffer.from(cookieToken);
    const b = Buffer.from(submitted);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
