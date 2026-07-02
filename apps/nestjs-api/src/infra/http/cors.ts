import type { ConfigService } from "@nestjs/config";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/**
 * CORS matching plane/settings/common.py: credentials allowed; explicit allowlist or reflect-all
 * fallback; allowed headers include X-API-Key (required by the external v1 API).
 */
export function buildCorsOptions(config: ConfigService): CorsOptions {
  const raw = config.get<string>("CORS_ALLOWED_ORIGINS", "");
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    credentials: true,
    origin: origins.length > 0 ? origins : true,
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Requested-With", "X-Request-Id"],
  };
}
