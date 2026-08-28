import type { SSHHost } from "../../../types/index.js";
import { randomUUID } from "node:crypto";
import type { PersistentSessionRepository } from "../../database/repositories/persistent-session-repository.js";
import { systemLogger } from "../../utils/logger.js";
import type { PersistentSessionGateway } from "./gateway.js";

export type PersistentSessionHost = { id: number; userId: string };
export type PersistentSessionHostResult = {
  hostId: number;
  status: "online" | "offline";
  observed: number;
  adopted: number;
  missing: number;
};
export type PersistentSessionReconcileResult = {
  hosts: number;
  recovered: number;
  discovered: number;
  missing: number;
  offline: number;
  results: PersistentSessionHostResult[];
};

/**
 * Reconciles durable facts from tmux.  A database row is never authoritative
 * enough to terminate a remote terminal: this component only observes or
 * creates records, and treats an unavailable host as unknown rather than gone.
 */
export class PersistentSessionReconciler {
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<PersistentSessionReconcileResult> | undefined;

  constructor(
    private readonly repository: PersistentSessionRepository,
    private readonly gateway: PersistentSessionGateway,
    private readonly listHosts: () => Promise<PersistentSessionHost[]>,
    private readonly resolveHost: (
      hostId: number,
      userId: string,
    ) => Promise<SSHHost | null>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.intervalTimer) return;
    void this.runOnce();
    this.intervalTimer = setInterval(() => void this.runOnce(), 60_000);
  }
  stop(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = undefined;
  }
  runOnce(): Promise<PersistentSessionReconcileResult> {
    if (!this.running)
      this.running = this.reconcile().finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async reconcile(): Promise<PersistentSessionReconcileResult> {
    const result = await this.reconcileHosts(await this.listHosts());
    // Sessions never expire, but ended rows are still pruned after 30 days
    // so history does not grow without bound.
    await this.repository.pruneEndedOlderThan(
      new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    return result;
  }

  async reconcileHosts(
    hosts: PersistentSessionHost[],
  ): Promise<PersistentSessionReconcileResult> {
    const result: PersistentSessionReconcileResult = {
      hosts: 0,
      recovered: 0,
      discovered: 0,
      missing: 0,
      offline: 0,
      results: [],
    };
    result.hosts = hosts.length;
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const hostInfo = hosts[next++];
        const host = await this.resolveHost(hostInfo.id, hostInfo.userId);
        // Do not reveal inaccessible hosts to an interactive caller.
        if (!host) continue;
        const hostResult: PersistentSessionHostResult = {
          hostId: hostInfo.id,
          status: "online",
          observed: 0,
          adopted: 0,
          missing: 0,
        };
        result.results.push(hostResult);
        let remote;
        try {
          remote = await this.gateway.list(host);
        } catch (error) {
          result.offline++;
          hostResult.status = "offline";
          systemLogger.warn(
            "Persistent-session reconciliation skipped unavailable host",
            {
              operation: "persistent_session_reconcile_offline",
              hostId: hostInfo.id,
              error: error instanceof Error ? error.message : "unknown",
            },
          );
          continue;
        }
        hostResult.observed = remote.length;
        const local = await this.repository.listActiveByHostForUser(
          hostInfo.id,
          hostInfo.userId,
        );
        const timestamp = this.now().toISOString();
        for (const row of local) {
          const observed = remote.find(
            (session) => session.name === row.tmuxSessionName,
          );
          if (!observed) {
            await this.repository.markEnded(
              row.id,
              hostInfo.userId,
              "disappeared",
            );
            result.missing++;
            hostResult.missing++;
          } else if (observed.marker?.id === row.id) {
            await this.repository.update(row.id, hostInfo.userId, {
              lastObservedAt: timestamp,
            });
          } else {
            await this.repository.recordEvent(row.id, "marker_mismatch", {
              actorId: hostInfo.userId,
            });
          }
        }
        for (const observed of remote) {
          const existing = await this.repository.findActiveByHostAndTmux(
            hostInfo.id,
            observed.name,
          );
          if (existing) continue;
          if (!observed.marker) {
            const id = randomUUID();
            const createdAt = observed.createdAt || timestamp;
            try {
              await this.gateway.mark(host, {
                name: observed.name,
                id,
                createdAt,
                expiryMode: "manual",
              });
              const marked = (await this.gateway.list(host)).find(
                (session) => session.name === observed.name,
              );
              if (!marked || marked.marker?.id !== id) continue;
              await this.repository.create(
                {
                  id,
                  userId: hostInfo.userId,
                  hostId: hostInfo.id,
                  displayName: observed.name,
                  tmuxSessionName: observed.name,
                  managementState: "managed",
                  expiryMode: "manual",
                  expirySeconds: null,
                  remoteCreatedAt: createdAt,
                },
                "adopted",
              );
              result.discovered++;
              hostResult.adopted++;
            } catch (error) {
              // A concurrent reconciliation may have adopted it first. The
              // unique active-session constraint makes that race harmless.
              if (
                !(error instanceof Error) ||
                !error.message.includes("CONFLICT")
              )
                throw error;
            }
            continue;
          }
          const createdAt =
            observed.marker.createdAt || observed.createdAt || timestamp;
          await this.repository.create(
            {
              id: observed.marker.id,
              userId: hostInfo.userId,
              hostId: hostInfo.id,
              displayName: observed.name,
              tmuxSessionName: observed.name,
              managementState: "managed",
              // Sessions never expire, so recovered rows are always manual
              // regardless of what a legacy remote marker claimed.
              expiryMode: "manual",
              expirySeconds: null,
              remoteCreatedAt: createdAt,
            },
            "recovered",
          );
          result.recovered++;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, hosts.length) }, () => worker()),
    );
    return result;
  }
}
