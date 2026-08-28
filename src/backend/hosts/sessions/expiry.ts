import type { SSHHost } from "../../../types/index.js";
import type { PersistentSessionRepository } from "../../database/repositories/persistent-session-repository.js";
import { systemLogger } from "../../utils/logger.js";
import type { PersistentSessionGateway } from "./gateway.js";

export type PersistentSessionExpiryResult = {
  expired: number;
  postponed: number;
  missing: number;
  offline: number;
  pruned: boolean;
};

/** Safe idle expiry: claim locally, re-read DB and tmux, then use guarded kill. */
export class PersistentSessionExpirer {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly claims = new Set<string>();
  constructor(
    private readonly repository: PersistentSessionRepository,
    private readonly gateway: PersistentSessionGateway,
    private readonly resolveHost: (
      hostId: number,
      userId: string,
    ) => Promise<SSHHost | null>,
    private readonly now: () => Date = () => new Date(),
  ) {}
  start(intervalMs = 60_000): void {
    if (!this.timer)
      this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  async runOnce(): Promise<PersistentSessionExpiryResult> {
    const result: PersistentSessionExpiryResult = {
      expired: 0,
      postponed: 0,
      missing: 0,
      offline: 0,
      pruned: false,
    };
    const now = this.now();
    for (const due of await this.repository.listDueExpiry(now.toISOString())) {
      if (this.claims.has(due.id)) continue;
      this.claims.add(due.id);
      try {
        const current = await this.repository.findByIdForUser(
          due.id,
          due.userId,
        );
        if (
          !current ||
          current.endedAt ||
          !current.expiresAt ||
          current.expiresAt > now.toISOString()
        )
          continue;
        const host = await this.resolveHost(current.hostId, current.userId);
        if (!host) {
          result.offline++;
          continue;
        }
        let remote;
        try {
          remote = (await this.gateway.list(host)).find(
            (item) => item.name === current.tmuxSessionName,
          );
        } catch {
          result.offline++;
          continue;
        }
        if (!remote) {
          await this.repository.markEnded(
            current.id,
            current.userId,
            "disappeared",
          );
          result.missing++;
          continue;
        }
        if (remote.marker?.id !== current.id) {
          await this.repository.recordEvent(
            current.id,
            "expiry_marker_mismatch",
            { actorId: current.userId },
          );
          continue;
        }
        if (remote.attachedClients > 0) {
          const seconds = current.expirySeconds ?? 300;
          await this.repository.update(current.id, current.userId, {
            expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
            lastObservedAt: now.toISOString(),
          });
          await this.repository.recordEvent(
            current.id,
            "expiry_postponed_attached",
            { actorId: current.userId },
          );
          result.postponed++;
          continue;
        }
        await this.gateway.kill(host, current.tmuxSessionName, current.id);
        const remaining = (await this.gateway.list(host)).find(
          (item) => item.name === current.tmuxSessionName,
        );
        if (remaining) {
          await this.repository.recordEvent(
            current.id,
            "expiry_kill_unconfirmed",
            { actorId: current.userId },
          );
          continue;
        }
        await this.repository.markEnded(current.id, current.userId, "expired");
        result.expired++;
      } catch (error) {
        systemLogger.warn("Persistent-session expiry skipped", {
          operation: "persistent_session_expiry_skipped",
          sessionId: due.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        this.claims.delete(due.id);
      }
    }
    await this.repository.pruneEndedOlderThan(
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    result.pruned = true;
    return result;
  }
}
