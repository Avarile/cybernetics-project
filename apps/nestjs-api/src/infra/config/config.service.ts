import { Injectable } from "@nestjs/common";

/**
 * Thin environment-backed config (uses `dotenv`, loaded in the bootstrap files) — avoids pulling in
 * @nestjs/config. DB-stored config (SMTP/OAuth/LLM secrets) is read separately via InstanceConfigService.
 */
@Injectable()
export class ConfigService {
  get<T = string>(key: string, fallback?: T): T {
    const value = process.env[key];
    return (value === undefined || value === "" ? (fallback as T) : (value as unknown as T)) as T;
  }

  getOrThrow<T = string>(key: string): T {
    const value = process.env[key];
    if (value === undefined || value === "") {
      throw new Error(`Configuration key "${key}" does not exist`);
    }
    return value as unknown as T;
  }
}
