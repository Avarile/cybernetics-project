import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../database/drizzle.module";
import { instanceConfigurations } from "../database/schema";
import { CryptoService } from "./crypto.service";

export interface ConfigItem {
  key: string;
  default?: string;
}

/**
 * Mirror of plane/license/utils/instance_value.py::get_configuration_value.
 * When SKIP_ENV_VAR == "1" (default), read from the InstanceConfiguration table (decrypting
 * is_encrypted values via Fernet); otherwise read from the environment. Order/fallback preserved.
 */
@Injectable()
export class InstanceConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async getConfigurationValues(items: ConfigItem[]): Promise<(string | undefined)[]> {
    const skipEnvVar = this.config.get<string>("SKIP_ENV_VAR", "1") === "1";

    if (!skipEnvVar) {
      return items.map((i) => process.env[i.key] ?? i.default);
    }

    const rows = await this.db
      .select()
      .from(instanceConfigurations)
      .where(
        inArray(
          instanceConfigurations.key,
          items.map((i) => i.key),
        ),
      );
    const byKey = new Map(rows.map((r) => [r.key, r]));

    return items.map((i) => {
      const row = byKey.get(i.key);
      if (!row || row.value === null || row.value === "") return i.default;
      return row.isEncrypted ? this.crypto.decrypt(row.value) : row.value;
    });
  }

  async getConfigurationValue(key: string, fallback?: string): Promise<string | undefined> {
    const [value] = await this.getConfigurationValues([{ key, default: fallback }]);
    return value;
  }
}
