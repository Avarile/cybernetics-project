import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "../../infra/config/config.service";
import { InstanceConfigService } from "../../infra/config/instance-config.service";
import { InstanceRepository } from "./instance.repository";

/**
 * Public instance bootstrap — GET /api/instances/ (AllowAny). Byte-parity with
 * plane/license/api/views/instance.py::InstanceEndpoint.get: returns { config, instance } (or a bare
 * {is_activated:false, is_setup_done:false} when no Instance row exists yet).
 *
 * NOTE: PATCH (admin update) and the admin sign-in/up/session flows are the larger instance-admin
 * surface tracked in the roadmap; this delivers the read the whole frontend bootstraps from.
 */
@Controller("api/instances")
export class InstanceController {
  constructor(
    private readonly repo: InstanceRepository,
    private readonly instanceConfig: InstanceConfigService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async get(): Promise<unknown> {
    const instance = await this.repo.firstInstance();
    if (!instance) {
      return { is_activated: false, is_setup_done: false };
    }

    const [
      ENABLE_SIGNUP,
      DISABLE_WORKSPACE_CREATION,
      IS_GOOGLE_ENABLED,
      IS_GITHUB_ENABLED,
      GITHUB_APP_NAME,
      IS_GITLAB_ENABLED,
      IS_GITEA_ENABLED,
      EMAIL_HOST,
      ENABLE_MAGIC_LINK_LOGIN,
      ENABLE_EMAIL_PASSWORD,
      SLACK_CLIENT_ID,
      POSTHOG_API_KEY,
      POSTHOG_HOST,
      UNSPLASH_ACCESS_KEY,
      LLM_API_KEY,
    ] = await this.instanceConfig.getConfigurationValues([
      { key: "ENABLE_SIGNUP", default: process.env.ENABLE_SIGNUP ?? "0" },
      { key: "DISABLE_WORKSPACE_CREATION", default: process.env.DISABLE_WORKSPACE_CREATION ?? "0" },
      { key: "IS_GOOGLE_ENABLED", default: process.env.IS_GOOGLE_ENABLED ?? "0" },
      { key: "IS_GITHUB_ENABLED", default: process.env.IS_GITHUB_ENABLED ?? "0" },
      { key: "GITHUB_APP_NAME", default: process.env.GITHUB_APP_NAME ?? "" },
      { key: "IS_GITLAB_ENABLED", default: process.env.IS_GITLAB_ENABLED ?? "0" },
      { key: "IS_GITEA_ENABLED", default: process.env.IS_GITEA_ENABLED ?? "0" },
      { key: "EMAIL_HOST", default: process.env.EMAIL_HOST ?? "" },
      { key: "ENABLE_MAGIC_LINK_LOGIN", default: process.env.ENABLE_MAGIC_LINK_LOGIN ?? "1" },
      { key: "ENABLE_EMAIL_PASSWORD", default: process.env.ENABLE_EMAIL_PASSWORD ?? "1" },
      { key: "SLACK_CLIENT_ID", default: process.env.SLACK_CLIENT_ID },
      { key: "POSTHOG_API_KEY", default: process.env.POSTHOG_API_KEY },
      { key: "POSTHOG_HOST", default: process.env.POSTHOG_HOST },
      { key: "UNSPLASH_ACCESS_KEY", default: process.env.UNSPLASH_ACCESS_KEY ?? "" },
      { key: "LLM_API_KEY", default: process.env.LLM_API_KEY ?? "" },
    ]);

    const config = {
      enable_signup: ENABLE_SIGNUP === "1",
      is_workspace_creation_disabled: DISABLE_WORKSPACE_CREATION === "1",
      is_google_enabled: IS_GOOGLE_ENABLED === "1",
      is_github_enabled: IS_GITHUB_ENABLED === "1",
      is_gitlab_enabled: IS_GITLAB_ENABLED === "1",
      is_gitea_enabled: IS_GITEA_ENABLED === "1",
      is_magic_login_enabled: ENABLE_MAGIC_LINK_LOGIN === "1",
      is_email_password_enabled: ENABLE_EMAIL_PASSWORD === "1",
      github_app_name: String(GITHUB_APP_NAME ?? ""),
      slack_client_id: SLACK_CLIENT_ID ?? null,
      posthog_api_key: POSTHOG_API_KEY ?? null,
      posthog_host: POSTHOG_HOST ?? null,
      has_unsplash_configured: Boolean(UNSPLASH_ACCESS_KEY),
      has_llm_configured: Boolean(LLM_API_KEY),
      file_size_limit: Number(this.config.get("FILE_SIZE_LIMIT", "5242880")),
      is_smtp_configured: Boolean(EMAIL_HOST),
      admin_base_url: this.config.get<string>("ADMIN_BASE_URL") ?? null,
      space_base_url: this.config.get<string>("SPACE_BASE_URL") ?? null,
      app_base_url: this.config.get<string>("APP_BASE_URL") ?? null,
      instance_changelog_url: this.config.get("INSTANCE_CHANGELOG_URL", ""),
      is_self_managed: true,
    };

    const instance_data = { ...instance, workspaces_exist: await this.repo.workspacesExist() };
    return { config, instance: instance_data };
  }
}
