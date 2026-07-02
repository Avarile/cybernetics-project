// Pragmatic transactional email templates. TODO(phase3): port the exact Django templates/emails/*.html.
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const wrap = (title: string, body: string): string =>
  `<div style="font-family:sans-serif;max-width:520px;margin:auto"><h2>${title}</h2>${body}<p style="color:#888;font-size:12px">Plane</p></div>`;

export const emailTemplates = {
  magicCode(code: string): RenderedEmail {
    return { subject: "Your Plane sign-in code", html: wrap("Sign in to Plane", `<p>Your code is <b>${code}</b>. It expires in 10 minutes.</p>`), text: `Your Plane sign-in code is ${code}` };
  },
  forgotPassword(firstName: string, resetUrl: string): RenderedEmail {
    return { subject: "Reset your Plane password", html: wrap("Reset your password", `<p>Hi ${firstName || "there"},</p><p><a href="${resetUrl}">Reset your password</a></p>`), text: `Reset your password: ${resetUrl}` };
  },
  workspaceInvitation(inviter: string, acceptUrl: string): RenderedEmail {
    return { subject: "You've been invited to a Plane workspace", html: wrap("Workspace invitation", `<p>${inviter} invited you to a workspace.</p><p><a href="${acceptUrl}">Accept invitation</a></p>`), text: `Accept: ${acceptUrl}` };
  },
  projectInvitation(invitor: string, acceptUrl: string): RenderedEmail {
    return { subject: "You've been invited to a Plane project", html: wrap("Project invitation", `<p>${invitor} invited you to a project.</p><p><a href="${acceptUrl}">Accept invitation</a></p>`), text: `Accept: ${acceptUrl}` };
  },
  userActivation(activateUrl: string): RenderedEmail {
    return { subject: "Activate your Plane account", html: wrap("Activate your account", `<p><a href="${activateUrl}">Activate</a></p>`), text: `Activate: ${activateUrl}` };
  },
  userDeactivation(): RenderedEmail {
    return { subject: "Your Plane account was deactivated", html: wrap("Account deactivated", `<p>Your account has been deactivated.</p>`), text: "Your Plane account was deactivated." };
  },
  emailUpdateMagicCode(code: string): RenderedEmail {
    return { subject: "Confirm your new email", html: wrap("Confirm your email", `<p>Your confirmation code is <b>${code}</b>.</p>`), text: `Confirmation code: ${code}` };
  },
  emailUpdateConfirmation(newEmail: string): RenderedEmail {
    return { subject: "Your Plane email was updated", html: wrap("Email updated", `<p>Your email was changed to ${newEmail}.</p>`), text: `Email updated to ${newEmail}` };
  },
  projectAddUser(projectName: string): RenderedEmail {
    return { subject: "You've been added to a Plane project", html: wrap("Added to a project", `<p>You were added to <b>${projectName}</b>.</p>`), text: `You were added to ${projectName}` };
  },
  webhookDeactivation(webhookUrl: string, reason: string): RenderedEmail {
    return { subject: "Your Plane webhook was deactivated", html: wrap("Webhook deactivated", `<p>The webhook <code>${webhookUrl}</code> was deactivated.</p><p>${reason}</p>`), text: `Webhook ${webhookUrl} deactivated: ${reason}` };
  },
  notificationDigest(count: number, items: string[]): RenderedEmail {
    return {
      subject: `You have ${count} update${count === 1 ? "" : "s"} on Plane`,
      html: wrap("Recent updates", `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`),
      text: items.join("\n"),
    };
  },
};
