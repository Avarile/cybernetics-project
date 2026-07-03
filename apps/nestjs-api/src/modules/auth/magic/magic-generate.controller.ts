import { Body, Controller, HttpCode, Inject, Post, UseFilters } from "@nestjs/common";
import { AuthJsonExceptionFilter } from "../../../infra/auth/auth-exception.filter";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../../infra/auth/error-codes";
import { DRIZZLE, type Database } from "../../../infra/database/drizzle.module";
import { instances } from "../../../infra/database/schema";
import { MailerService } from "../../../infra/mailer/mailer.service";
import { MagicCodeService } from "./magic-code.service";
import { renderMagicCodeEmail } from "./magic-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * plane/authentication/views/app/magic.py::MagicGenerateEndpoint. Mounted at /auth (app) and
 * /auth/spaces (space) to match Django's two front-end-facing paths -- both hit the same handler.
 * Django enqueues a Celery task (magic_link.delay) to send the email; here it's sent inline via
 * MailerService since there's no task queue in the request path.
 */
@Controller("auth")
@UseFilters(AuthJsonExceptionFilter)
export class MagicGenerateController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly magicCode: MagicCodeService,
    private readonly mailer: MailerService,
  ) {}

  @Post("magic-generate")
  @HttpCode(200)
  magicGenerate(@Body() body: { email?: unknown }): Promise<{ key: string }> {
    return this.generate(body?.email);
  }

  @Post("spaces/magic-generate")
  @HttpCode(200)
  spacesMagicGenerate(@Body() body: { email?: unknown }): Promise<{ key: string }> {
    return this.generate(body?.email);
  }

  private async generate(rawEmail: unknown): Promise<{ key: string }> {
    await this.assertInstanceSetup();

    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    // MagicCodeProvider.__init__ gate (SMTP + magic-enabled) -- initiate()/verify() do not self-gate.
    await this.magicCode.assertEnabled(email);

    if (!email) {
      throw new AuthError({ code: AUTHENTICATION_ERROR_CODES.EMAIL_REQUIRED, message: "EMAIL_REQUIRED" });
    }
    if (!EMAIL_RE.test(email)) {
      throw new AuthError({ code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL, message: "INVALID_EMAIL" });
    }

    const { key, token } = await this.magicCode.initiate(email);
    const rendered = renderMagicCodeEmail(token);
    await this.mailer.send({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text });
    return { key };
  }

  /** check.py/email.py/magic.py -- `if instance is None or not instance.is_setup_done` is the first
   * check in every auth view. Duplicated from EmailProvider.assertInstanceSetup (same as Django,
   * which repeats this inline in every view rather than sharing it). */
  private async assertInstanceSetup(): Promise<void> {
    const [instance] = await this.db.select().from(instances).limit(1);
    if (!instance || !instance.isSetupDone) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.INSTANCE_NOT_CONFIGURED,
        message: "INSTANCE_NOT_CONFIGURED",
      });
    }
  }
}
