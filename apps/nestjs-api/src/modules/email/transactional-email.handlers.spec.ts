import { describe, it, expect, vi } from "vitest";
import type { MailerService, OutgoingEmail } from "../../infra/mailer/mailer.service";
import type { EmailRepository } from "./email.repository";
import {
  ForgotPasswordEmailHandler,
  MagicLinkEmailHandler,
  UserActivationEmailHandler,
  WebhookDeactivationEmailHandler,
} from "./transactional-email.handlers";

function mailerSpy() {
  const sent: OutgoingEmail[] = [];
  const mailer = { send: vi.fn().mockImplementation(async (m: OutgoingEmail) => void sent.push(m)) } as unknown as MailerService;
  return { mailer, sent };
}

describe("transactional email handlers", () => {
  it("magic link sends the code to the email", async () => {
    const { mailer, sent } = mailerSpy();
    await new MagicLinkEmailHandler(mailer).run({ email: "a@b.com", key: "k", token: "482915" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@b.com");
    expect(sent[0].subject).toMatch(/sign-in code/i);
    expect(sent[0].html).toContain("482915");
  });

  it("forgot password builds the reset URL from current_site", async () => {
    const { mailer, sent } = mailerSpy();
    await new ForgotPasswordEmailHandler(mailer).run({
      first_name: "Ada",
      email: "ada@x.com",
      uidb64: "UID",
      token: "TOK",
      current_site: "https://app.plane.test",
    });
    expect(sent[0].html).toContain("https://app.plane.test/accounts/reset-password?uidb64=UID&token=TOK");
  });

  it("user activation looks up the user's email", async () => {
    const { mailer, sent } = mailerSpy();
    const repo = { getUser: vi.fn().mockResolvedValue({ email: "u@x.com", firstName: "U" }) } as unknown as EmailRepository;
    await new UserActivationEmailHandler(mailer, repo).run({ current_site: "https://app", user_id: "u1" });
    expect(sent[0].to).toBe("u@x.com");
  });

  it("webhook deactivation resolves receiver email + webhook url", async () => {
    const { mailer, sent } = mailerSpy();
    const repo = {
      getUser: vi.fn().mockResolvedValue({ email: "own@x.com", firstName: null }),
      getWebhookUrl: vi.fn().mockResolvedValue("https://hooks.example.com/x"),
    } as unknown as EmailRepository;
    await new WebhookDeactivationEmailHandler(mailer, repo).run({ webhook_id: "wh1", receiver_id: "u1", reason: "too many failures" });
    expect(sent[0].to).toBe("own@x.com");
    expect(sent[0].html).toContain("https://hooks.example.com/x");
    expect(sent[0].html).toContain("too many failures");
  });

  it("does not send when the email is missing", async () => {
    const { mailer, sent } = mailerSpy();
    await new MagicLinkEmailHandler(mailer).run({ token: "1" });
    expect(sent).toHaveLength(0);
  });
});
