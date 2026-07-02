import { Injectable } from "@nestjs/common";
import { MailerService } from "../../infra/mailer/mailer.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { EmailRepository } from "./email.repository";
import { emailTemplates } from "./templates";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

@CeleryTaskHandler()
@Injectable()
export class MagicLinkEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.magicLink;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    if (to) await this.mailer.send({ to, ...emailTemplates.magicCode(str(k.token)) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class ForgotPasswordEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.forgotPassword;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    const url = `${str(k.current_site)}/accounts/reset-password?uidb64=${str(k.uidb64)}&token=${str(k.token)}`;
    if (to) await this.mailer.send({ to, ...emailTemplates.forgotPassword(str(k.first_name), url) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class WorkspaceInvitationEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.workspaceInvitation;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    const url = `${str(k.current_site)}/workspace-invitations?workspace_id=${str(k.workspace_id)}&token=${str(k.token)}&email=${encodeURIComponent(to)}`;
    if (to) await this.mailer.send({ to, ...emailTemplates.workspaceInvitation(str(k.inviter), url) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class ProjectInvitationEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.projectInvitation;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    const url = `${str(k.current_site)}/project-invitations?project_id=${str(k.project_id)}&token=${str(k.token)}&email=${encodeURIComponent(to)}`;
    if (to) await this.mailer.send({ to, ...emailTemplates.projectInvitation(str(k.invitor), url) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class UserActivationEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.userActivationEmail;
  constructor(private readonly mailer: MailerService, private readonly repo: EmailRepository) {}
  async run(k: CeleryKwargs): Promise<void> {
    const user = await this.repo.getUser(str(k.user_id));
    if (user?.email) await this.mailer.send({ to: user.email, ...emailTemplates.userActivation(`${str(k.current_site)}/`) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class UserDeactivationEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.userDeactivationEmail;
  constructor(private readonly mailer: MailerService, private readonly repo: EmailRepository) {}
  async run(k: CeleryKwargs): Promise<void> {
    const user = await this.repo.getUser(str(k.user_id));
    if (user?.email) await this.mailer.send({ to: user.email, ...emailTemplates.userDeactivation() });
  }
}

@CeleryTaskHandler()
@Injectable()
export class EmailUpdateMagicCodeHandler implements TaskHandler {
  readonly name = CELERY_TASKS.emailUpdateMagicCode;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    if (to) await this.mailer.send({ to, ...emailTemplates.emailUpdateMagicCode(str(k.token)) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class EmailUpdateConfirmationHandler implements TaskHandler {
  readonly name = CELERY_TASKS.emailUpdateConfirmation;
  constructor(private readonly mailer: MailerService) {}
  async run(k: CeleryKwargs): Promise<void> {
    const to = str(k.email);
    if (to) await this.mailer.send({ to, ...emailTemplates.emailUpdateConfirmation(to) });
  }
}

@CeleryTaskHandler()
@Injectable()
export class ProjectAddUserEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.projectAddUserEmail;
  constructor(private readonly mailer: MailerService, private readonly repo: EmailRepository) {}
  async run(k: CeleryKwargs): Promise<void> {
    const userId = await this.repo.getProjectMemberUserId(str(k.project_member_id));
    if (!userId) return;
    const user = await this.repo.getUser(userId);
    if (user?.email) await this.mailer.send({ to: user.email, ...emailTemplates.projectAddUser("your project") });
  }
}

@CeleryTaskHandler()
@Injectable()
export class WebhookDeactivationEmailHandler implements TaskHandler {
  readonly name = CELERY_TASKS.sendWebhookDeactivationEmail;
  constructor(private readonly mailer: MailerService, private readonly repo: EmailRepository) {}
  async run(k: CeleryKwargs): Promise<void> {
    const [user, url] = await Promise.all([this.repo.getUser(str(k.receiver_id)), this.repo.getWebhookUrl(str(k.webhook_id))]);
    if (user?.email) await this.mailer.send({ to: user.email, ...emailTemplates.webhookDeactivation(url ?? "", str(k.reason)) });
  }
}

export const TRANSACTIONAL_EMAIL_HANDLERS = [
  MagicLinkEmailHandler,
  ForgotPasswordEmailHandler,
  WorkspaceInvitationEmailHandler,
  ProjectInvitationEmailHandler,
  UserActivationEmailHandler,
  UserDeactivationEmailHandler,
  EmailUpdateMagicCodeHandler,
  EmailUpdateConfirmationHandler,
  ProjectAddUserEmailHandler,
  WebhookDeactivationEmailHandler,
];
