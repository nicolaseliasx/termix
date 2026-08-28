import { and, desc, eq, isNull, lt, lte } from "drizzle-orm";
import { persistentSessionEvents, persistentSessions } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning } from "./returning.js";

export type PersistentSessionRecord = typeof persistentSessions.$inferSelect;
export type PersistentSessionEventRecord =
  typeof persistentSessionEvents.$inferSelect;

export interface PersistentSessionCreateInput {
  id: string;
  userId: string;
  hostId: number;
  displayName: string;
  tmuxSessionName: string;
  managementState: "managed" | "discovered";
  expiryMode: "manual" | "idle";
  expirySeconds?: number | null;
  remoteCreatedAt?: string | null;
}

/** Owner-scoped persistence for facts about remote tmux sessions. */
export class PersistentSessionRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(
    input: PersistentSessionCreateInput,
    eventType = "created",
  ): Promise<PersistentSessionRecord> {
    const existing = await this.findActiveByHostAndTmux(
      input.hostId,
      input.tmuxSessionName,
    );
    if (existing) throw new Error("PERSISTENT_SESSION_CONFLICT");
    const [record] = await insertReturning(
      this.context,
      persistentSessions,
      input,
    );
    await this.context.drizzle
      .insert(persistentSessionEvents)
      .values({ sessionId: record.id, eventType, actorId: input.userId });
    await this.afterWrite();
    return record;
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<PersistentSessionRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(persistentSessions)
      .where(
        and(
          eq(persistentSessions.id, id),
          eq(persistentSessions.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveByHostAndTmux(
    hostId: number,
    tmuxSessionName: string,
  ): Promise<PersistentSessionRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(persistentSessions)
      .where(
        and(
          eq(persistentSessions.hostId, hostId),
          eq(persistentSessions.tmuxSessionName, tmuxSessionName),
          isNull(persistentSessions.endedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUser(
    userId: string,
    options: { includeEnded?: boolean; limit?: number; offset?: number } = {},
  ): Promise<{ data: PersistentSessionRecord[]; total: number }> {
    const where = options.includeEnded
      ? eq(persistentSessions.userId, userId)
      : and(
          eq(persistentSessions.userId, userId),
          isNull(persistentSessions.endedAt),
        );
    const data = await this.context.drizzle
      .select()
      .from(persistentSessions)
      .where(where)
      .orderBy(desc(persistentSessions.createdAt), desc(persistentSessions.id))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
    const all = await this.context.drizzle
      .select({ id: persistentSessions.id })
      .from(persistentSessions)
      .where(where);
    return { data, total: all.length };
  }

  async listActiveByHostForUser(
    hostId: number,
    userId: string,
  ): Promise<PersistentSessionRecord[]> {
    return this.context.drizzle
      .select()
      .from(persistentSessions)
      .where(
        and(
          eq(persistentSessions.hostId, hostId),
          eq(persistentSessions.userId, userId),
          isNull(persistentSessions.endedAt),
        ),
      );
  }

  /** Event writes are deliberately separate from remote lifecycle work. */
  async recordEvent(
    id: string,
    eventType: string,
    options: { actorId?: string | null; details?: string | null } = {},
  ): Promise<void> {
    await this.context.drizzle.insert(persistentSessionEvents).values({
      sessionId: id,
      eventType,
      actorId: options.actorId ?? null,
      details: options.details ?? null,
    });
    await this.afterWrite();
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<
      Pick<
        PersistentSessionRecord,
        | "displayName"
        | "tmuxSessionName"
        | "expiryMode"
        | "expirySeconds"
        | "expiresAt"
        | "lastObservedAt"
        | "lastAttachedAt"
        | "lastDetachedAt"
      >
    >,
  ): Promise<PersistentSessionRecord | null> {
    const current = await this.findByIdForUser(id, userId);
    if (!current) return null;
    if (
      patch.tmuxSessionName &&
      patch.tmuxSessionName !== current.tmuxSessionName
    ) {
      const conflict = await this.findActiveByHostAndTmux(
        current.hostId,
        patch.tmuxSessionName,
      );
      if (conflict && conflict.id !== id)
        throw new Error("PERSISTENT_SESSION_CONFLICT");
    }
    await this.context.drizzle
      .update(persistentSessions)
      .set(patch)
      .where(eq(persistentSessions.id, id));
    await this.context.drizzle
      .insert(persistentSessionEvents)
      .values({ sessionId: id, eventType: "updated", actorId: userId });
    await this.afterWrite();
    return this.findByIdForUser(id, userId);
  }

  async markEnded(
    id: string,
    userId: string,
    reason: "killed" | "expired" | "disappeared",
  ): Promise<PersistentSessionRecord | null> {
    const row = await this.findByIdForUser(id, userId);
    if (!row) return null;
    if (row.endedAt) return row;
    await this.context.drizzle
      .update(persistentSessions)
      .set({ endedAt: new Date().toISOString(), endReason: reason })
      .where(eq(persistentSessions.id, id));
    await this.context.drizzle
      .insert(persistentSessionEvents)
      .values({ sessionId: id, eventType: reason, actorId: userId });
    await this.afterWrite();
    return this.findByIdForUser(id, userId);
  }

  async listDueExpiry(now: string): Promise<PersistentSessionRecord[]> {
    return this.context.drizzle
      .select()
      .from(persistentSessions)
      .where(
        and(
          eq(persistentSessions.expiryMode, "idle"),
          isNull(persistentSessions.endedAt),
          lte(persistentSessions.expiresAt, now),
        ),
      );
  }

  async pruneEndedOlderThan(cutoff: string): Promise<void> {
    const rows = await this.context.drizzle
      .select({ id: persistentSessions.id })
      .from(persistentSessions)
      .where(and(lt(persistentSessions.endedAt, cutoff)));
    for (const row of rows)
      await this.context.drizzle
        .delete(persistentSessions)
        .where(eq(persistentSessions.id, row.id));
    if (rows.length) await this.afterWrite();
  }
  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
