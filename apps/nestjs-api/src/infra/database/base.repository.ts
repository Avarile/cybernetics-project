import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { ClsService } from "nestjs-cls";
import { CLS_USER_ID } from "../context/cls.constants";
import type { Database } from "./drizzle.module";

/** Tables built from `baseColumns` expose these columns; the base repository requires them. */
export type BaseColumnsShape = {
  id: PgColumn;
  deletedAt: PgColumn;
  createdBy: PgColumn;
  updatedBy: PgColumn;
};

/**
 * Centralises Django's implicit base-model behaviours (plane/db/mixins.py) that Drizzle has no
 * hooks for: soft-delete default scope, `all_objects` escape hatch, and audit stamping from the
 * request-scoped current user (crum.get_current_user() -> nestjs-cls).
 *
 * Drizzle's insert/update builders are hard to type generically, so writes cast at the call
 * boundary while the public API stays typed via T['$inferInsert'] / T['$inferSelect'].
 */
export abstract class BaseRepository<T extends PgTable & BaseColumnsShape> {
  protected constructor(
    protected readonly db: Database,
    protected readonly table: T,
    protected readonly cls: ClsService,
  ) {}

  /** Override to add manager-level default filters (IssueManager, StateManager, ...). */
  protected defaultScope(): SQL | undefined {
    return isNull(this.table.deletedAt);
  }

  protected currentUserId(): string | null {
    return this.cls.get(CLS_USER_ID) ?? null;
  }

  /** BaseModel.save() on create: set created_by, leave updated_by null. */
  protected stampInsert<V extends Record<string, unknown>>(values: V): V {
    const userId = this.currentUserId();
    return { createdBy: userId, updatedBy: null, ...values };
  }

  /** BaseModel.save() on update: set updated_by only. */
  protected stampUpdate<V extends Record<string, unknown>>(values: V): V {
    return { ...values, updatedBy: this.currentUserId() };
  }

  find(where?: SQL, opts?: { includeDeleted?: boolean }) {
    const scope = opts?.includeDeleted ? undefined : this.defaultScope();
    const predicate = and(scope, where);
    return this.db
      .select()
      .from(this.table as PgTable)
      .where(predicate);
  }

  async findById(id: string, opts?: { includeDeleted?: boolean }): Promise<T["$inferSelect"] | null> {
    const rows = await this.find(eq(this.table.id, id), opts).limit(1);
    return (rows[0] as T["$inferSelect"]) ?? null;
  }

  async create(values: T["$inferInsert"]): Promise<T["$inferSelect"]> {
    const stamped = this.stampInsert(values as Record<string, unknown>);
    const rows = await this.db
      .insert(this.table)
      .values(stamped as T["$inferInsert"])
      .returning();
    return rows[0] as T["$inferSelect"];
  }

  async update(id: string, values: Partial<T["$inferInsert"]>): Promise<T["$inferSelect"] | null> {
    const stamped = this.stampUpdate(values as Record<string, unknown>);
    const rows = await this.db
      .update(this.table)
      .set(stamped)
      .where(eq(this.table.id, id))
      .returning();
    return (rows[0] as T["$inferSelect"]) ?? null;
  }

  /** SoftDeleteModel.delete(): set deleted_at + updated_by (cascade is enqueued by subclasses). */
  async softDelete(id: string): Promise<void> {
    const patch: Record<string, unknown> = { deletedAt: new Date(), updatedBy: this.currentUserId() };
    await this.db.update(this.table).set(patch).where(eq(this.table.id, id));
  }

  hardDelete(id: string) {
    return this.db.delete(this.table).where(eq(this.table.id, id));
  }
}
