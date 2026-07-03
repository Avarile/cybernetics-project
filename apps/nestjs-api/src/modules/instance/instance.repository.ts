import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";

/** Reads for the public instance bootstrap. Uses row_to_json to reproduce InstanceSerializer's __all__. */
@Injectable()
export class InstanceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The single instance row as a snake_case JSON object (fields = "__all__"), or null if unregistered. */
  async firstInstance(): Promise<Record<string, unknown> | null> {
    const res = await this.db.execute(
      sql`SELECT row_to_json(t) AS row FROM (SELECT * FROM instances ORDER BY created_at ASC LIMIT 1) t`,
    );
    const rows = (res as unknown as { rows: Array<{ row: Record<string, unknown> }> }).rows;
    return rows[0]?.row ?? null;
  }

  async workspacesExist(): Promise<boolean> {
    const res = await this.db.execute(sql`SELECT COUNT(*)::int AS count FROM workspaces`);
    const rows = (res as unknown as { rows: Array<{ count: number }> }).rows;
    return (rows[0]?.count ?? 0) >= 1;
  }
}
