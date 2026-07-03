import { Body, Controller, HttpCode, Post, UseFilters } from "@nestjs/common";
import { AuthJsonExceptionFilter } from "../../infra/auth/auth-exception.filter";
import { EmailProvider } from "./email.provider";

/**
 * plane/authentication/views/app/check.py::EmailCheckEndpoint. Mounted at /auth (app) and
 * /auth/spaces (space) to match Django's two front-end-facing paths -- both hit the same handler.
 */
@Controller("auth")
@UseFilters(AuthJsonExceptionFilter)
export class EmailCheckController {
  constructor(private readonly emailProvider: EmailProvider) {}

  @Post("email-check")
  @HttpCode(200)
  emailCheck(@Body() body: { email?: unknown }) {
    return this.emailProvider.emailCheck(body?.email);
  }

  @Post("spaces/email-check")
  @HttpCode(200)
  spacesEmailCheck(@Body() body: { email?: unknown }) {
    return this.emailProvider.emailCheck(body?.email);
  }
}
