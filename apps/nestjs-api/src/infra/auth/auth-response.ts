import type { Request, Response } from "express";
import type { ConfigService } from "../config/config.service";
import { baseHost, getSafeRedirectUrl, type Audience } from "./redirect";
import type { AuthError } from "./error-codes";

/**
 * Form-POST auth endpoints 302-redirect to `base/?<params>` rather than returning JSON --
 * success carries no error params, failure carries `err.getErrorDict()`. Mirrors Django's
 * redirect-based auth flows (see redirect.ts header for the underlying host/path safety port).
 */
export function redirectSuccess(
  cfg: ConfigService,
  res: Response,
  req: Request,
  audience: Audience,
  nextPath: string,
): void {
  res.redirect(getSafeRedirectUrl(cfg, baseHost(cfg, audience), nextPath, {}));
}

export function redirectError(
  cfg: ConfigService,
  res: Response,
  req: Request,
  audience: Audience,
  err: AuthError,
  nextPath: string,
): void {
  res.redirect(getSafeRedirectUrl(cfg, baseHost(cfg, audience), nextPath, err.getErrorDict()));
}
