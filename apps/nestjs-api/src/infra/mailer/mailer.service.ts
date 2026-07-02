import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { InstanceConfigService } from "../config/instance-config.service";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * SMTP mailer reading the same InstanceConfiguration email settings as Django
 * (plane/license/utils/instance_value.py::get_email_configuration). If EMAIL_HOST is unset the
 * service no-ops (logs + skips) so unconfigured instances don't fail — matching Django's behaviour.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transport?: nodemailer.Transporter | null;
  private from = "Team Plane <team@mailer.plane.so>";

  constructor(private readonly config: InstanceConfigService) {}

  private async ensureTransport(): Promise<nodemailer.Transporter | null> {
    if (this.transport !== undefined) return this.transport;
    const [host, user, pass, port, useTls, useSsl, from] = await this.config.getConfigurationValues([
      { key: "EMAIL_HOST" },
      { key: "EMAIL_HOST_USER" },
      { key: "EMAIL_HOST_PASSWORD" },
      { key: "EMAIL_PORT", default: "587" },
      { key: "EMAIL_USE_TLS", default: "1" },
      { key: "EMAIL_USE_SSL", default: "0" },
      { key: "EMAIL_FROM", default: "Team Plane <team@mailer.plane.so>" },
    ]);
    if (!host) {
      this.transport = null;
      return null;
    }
    this.from = from || this.from;
    this.transport = nodemailer.createTransport({
      host,
      port: Number(port) || 587,
      secure: useSsl === "1",
      requireTLS: useTls === "1",
      auth: user ? { user, pass: pass ?? "" } : undefined,
    });
    return this.transport;
  }

  async send(mail: OutgoingEmail): Promise<void> {
    const transport = await this.ensureTransport();
    if (!transport) {
      this.logger.warn(`Email not configured (no EMAIL_HOST); skipping mail "${mail.subject}" to ${mail.to}`);
      return;
    }
    await transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  }
}
