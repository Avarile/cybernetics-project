import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { CsrfService } from "../../infra/auth/csrf.service";

/**
 * Issues the CSRF double-submit cookie. Mounted at /auth (app) and /auth/spaces (space) to match
 * Django's two front-end-facing paths -- both hit the same handler.
 */
@Controller("auth")
export class CsrfController {
  constructor(private readonly csrf: CsrfService) {}

  @Get("get-csrf-token")
  getCsrfToken(@Res({ passthrough: true }) res: Response) {
    return { csrf_token: this.csrf.issue(res) };
  }

  @Get("spaces/get-csrf-token")
  getSpacesCsrfToken(@Res({ passthrough: true }) res: Response) {
    return { csrf_token: this.csrf.issue(res) };
  }
}
