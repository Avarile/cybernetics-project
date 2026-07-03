export interface ConfigVar {
  key: string;
  value: string | undefined;
  category: string;
  isEncrypted: boolean;
}

const env = (k: string, d?: string) => process.env[k] ?? d;

// Mirror of plane/utils/instance_config_variables/core.py (extended.py is empty).
export const INSTANCE_CONFIG_VARIABLES: ConfigVar[] = [
  { key: "ENABLE_SIGNUP", value: env("ENABLE_SIGNUP", "1"), category: "AUTHENTICATION", isEncrypted: false },
  {
    key: "ENABLE_EMAIL_PASSWORD",
    value: env("ENABLE_EMAIL_PASSWORD", "1"),
    category: "AUTHENTICATION",
    isEncrypted: false,
  },
  {
    key: "ENABLE_MAGIC_LINK_LOGIN",
    value: env("ENABLE_MAGIC_LINK_LOGIN", "0"),
    category: "AUTHENTICATION",
    isEncrypted: false,
  },
  {
    key: "DISABLE_WORKSPACE_CREATION",
    value: env("DISABLE_WORKSPACE_CREATION", "0"),
    category: "WORKSPACE_MANAGEMENT",
    isEncrypted: false,
  },
  { key: "GOOGLE_CLIENT_ID", value: env("GOOGLE_CLIENT_ID"), category: "GOOGLE", isEncrypted: false },
  { key: "GOOGLE_CLIENT_SECRET", value: env("GOOGLE_CLIENT_SECRET"), category: "GOOGLE", isEncrypted: true },
  { key: "ENABLE_GOOGLE_SYNC", value: env("ENABLE_GOOGLE_SYNC", "0"), category: "GOOGLE", isEncrypted: false },
  { key: "GITHUB_CLIENT_ID", value: env("GITHUB_CLIENT_ID"), category: "GITHUB", isEncrypted: false },
  { key: "GITHUB_CLIENT_SECRET", value: env("GITHUB_CLIENT_SECRET"), category: "GITHUB", isEncrypted: true },
  { key: "GITHUB_ORGANIZATION_ID", value: env("GITHUB_ORGANIZATION_ID"), category: "GITHUB", isEncrypted: false },
  { key: "ENABLE_GITHUB_SYNC", value: env("ENABLE_GITHUB_SYNC", "0"), category: "GITHUB", isEncrypted: false },
  { key: "GITLAB_HOST", value: env("GITLAB_HOST"), category: "GITLAB", isEncrypted: false },
  { key: "GITLAB_CLIENT_ID", value: env("GITLAB_CLIENT_ID"), category: "GITLAB", isEncrypted: false },
  { key: "GITLAB_CLIENT_SECRET", value: env("GITLAB_CLIENT_SECRET"), category: "GITLAB", isEncrypted: true },
  { key: "ENABLE_GITLAB_SYNC", value: env("ENABLE_GITLAB_SYNC", "0"), category: "GITLAB", isEncrypted: false },
  { key: "IS_GITEA_ENABLED", value: env("IS_GITEA_ENABLED", "0"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_HOST", value: env("GITEA_HOST"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_CLIENT_ID", value: env("GITEA_CLIENT_ID"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_CLIENT_SECRET", value: env("GITEA_CLIENT_SECRET"), category: "GITEA", isEncrypted: true },
  { key: "ENABLE_GITEA_SYNC", value: env("ENABLE_GITEA_SYNC", "0"), category: "GITEA", isEncrypted: false },
  { key: "ENABLE_SMTP", value: env("ENABLE_SMTP", "0"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST", value: env("EMAIL_HOST", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST_USER", value: env("EMAIL_HOST_USER", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST_PASSWORD", value: env("EMAIL_HOST_PASSWORD", ""), category: "SMTP", isEncrypted: true },
  { key: "EMAIL_PORT", value: env("EMAIL_PORT", "587"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_FROM", value: env("EMAIL_FROM", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_USE_TLS", value: env("EMAIL_USE_TLS", "1"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_USE_SSL", value: env("EMAIL_USE_SSL", "0"), category: "SMTP", isEncrypted: false },
  { key: "LLM_API_KEY", value: env("LLM_API_KEY"), category: "AI", isEncrypted: true },
  { key: "LLM_PROVIDER", value: env("LLM_PROVIDER", "openai"), category: "AI", isEncrypted: false },
  { key: "LLM_MODEL", value: env("LLM_MODEL", "gpt-4o-mini"), category: "AI", isEncrypted: false },
  { key: "GPT_ENGINE", value: env("GPT_ENGINE", "gpt-3.5-turbo"), category: "AI", isEncrypted: false },
  { key: "UNSPLASH_ACCESS_KEY", value: env("UNSPLASH_ACCESS_KEY", ""), category: "UNSPLASH", isEncrypted: true },
];
