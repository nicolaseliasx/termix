import type { SSHHost } from "../../../types/index.js";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type {
  PersistentSessionRecord,
  PersistentSessionRepository,
} from "../../database/repositories/persistent-session-repository.js";
import { systemLogger } from "../../utils/logger.js";
import type { PersistentSessionGateway } from "./gateway.js";
import type { RemotePersistentSession } from "./types.js";

export type PersistentSessionHost = { id: number; userId: string };
export type PersistentSessionHostResult = {
  hostId: number;
  status: "online" | "offline";
  observed: number;
  adopted: number;
  missing: number;
  hibernated: number;
  thawed: number;
};
export type PersistentSessionReconcileResult = {
  hosts: number;
  recovered: number;
  discovered: number;
  missing: number;
  offline: number;
  results: PersistentSessionHostResult[];
};

type FailureState = { failures: number; nextTry: number; lastLog: number };
type ReconcilerOptions = {
  reachability?: (host: SSHHost, timeoutMs: number) => Promise<boolean>;
  /** Idle hours before a session's pane processes are frozen; 0 disables. */
  hibernateIdleHours?: () => Promise<number>;
  /** Live termix attachments for a session id (freeze never touches them). */
  attachedClients?: (sessionId: string) => number;
};

const MAX_ACTIVE_HOSTS = 4;
const BACKOFF_MS = [300_000, 900_000, 1_800_000, 3_600_000];
const FAST_GATE_TIMEOUT_MS = 2_000;
const HIBERNATE_IDLE_HOURS_SETTING = "persistent_session_idle_hibernate_hours";
const DEFAULT_IDLE_HIBERNATE_HOURS = 6;
const HIBERNATE_HOURS_CACHE_MS = 60_000;

/**
 * Observes tmux without treating an unavailable host as a missing session.
 * The in-flight and backoff maps are instance-wide so maintenance and API
 * callers share both deduplication and the four-host concurrency limit.
 */
export class PersistentSessionReconciler {
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<PersistentSessionReconcileResult> | undefined;
  private readonly inFlight = new Map<
    string,
    Promise<PersistentSessionHostResult | null>
  >();
  private readonly failures = new Map<string, FailureState>();
  private readonly recoveredCounts = new WeakMap<object, number>();
  private readonly remoteSnapshots = new Map<
    string,
    RemotePersistentSession[]
  >();
  private activeHosts = 0;
  private readonly reachability: (
    host: SSHHost,
    timeoutMs: number,
  ) => Promise<boolean>;
  private readonly hibernateIdleHoursReader: () => Promise<number>;
  private readonly attachedClients: (sessionId: string) => number;
  private hibernateHoursCache: { value: number; expires: number } | undefined;

  constructor(
    private readonly repository: PersistentSessionRepository,
    private readonly gateway: PersistentSessionGateway,
    private readonly listHosts: () => Promise<PersistentSessionHost[]>,
    private readonly resolveHost: (
      hostId: number,
      userId: string,
    ) => Promise<SSHHost | null>,
    private readonly now: () => Date = () => new Date(),
    options: ReconcilerOptions = {},
  ) {
    this.reachability = options.reachability ?? probeTcpReachability;
    this.hibernateIdleHoursReader =
      options.hibernateIdleHours ?? readConfiguredHours;
    this.attachedClients = options.attachedClients ?? (() => 0);
  }

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
    if (!this.running) {
      this.running = this.reconcile().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async reconcile(): Promise<PersistentSessionReconcileResult> {
    const result = await this.reconcileHosts(await this.listHosts());
    await this.repository.pruneEndedOlderThan(
      new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
    return result;
  }

  async reconcileHosts(
    hosts: PersistentSessionHost[],
  ): Promise<PersistentSessionReconcileResult> {
    const result: PersistentSessionReconcileResult = {
      hosts: hosts.length,
      recovered: 0,
      discovered: 0,
      missing: 0,
      offline: 0,
      results: [],
    };
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const hostInfo = hosts[next++];
        const key = `${hostInfo.userId}:${hostInfo.id}`;
        let operation = this.inFlight.get(key);
        if (!operation) {
          operation = this.reconcileOne(hostInfo);
          this.inFlight.set(key, operation);
          void operation
            .finally(() => this.inFlight.delete(key))
            .catch(() => {});
        }
        const hostResult = await operation;
        if (!hostResult) continue;
        result.results.push(hostResult);
        result.offline += hostResult.status === "offline" ? 1 : 0;
        result.recovered += this.recoveredCounts.get(hostResult) ?? 0;
        result.discovered += hostResult.adopted;
        result.missing += hostResult.missing;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_ACTIVE_HOSTS, hosts.length) }, () =>
        worker(),
      ),
    );
    return result;
  }

  /** Single-host compatibility shape used by the existing API route. */
  async reconcileHost(
    hostId: number,
    userId: string,
  ): Promise<{
    sessions: RemotePersistentSession[];
    discovered: RemotePersistentSession[];
  }> {
    await this.reconcileHosts([{ id: hostId, userId }]);
    const sessions = this.remoteSnapshots.get(`${userId}:${hostId}`) ?? [];
    return {
      sessions,
      discovered: sessions.filter((session) => !session.marker),
    };
  }

  private async acquireSlot(): Promise<void> {
    while (this.activeHosts >= MAX_ACTIVE_HOSTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    this.activeHosts += 1;
  }

  private async reconcileOne(
    hostInfo: PersistentSessionHost,
  ): Promise<PersistentSessionHostResult | null> {
    await this.acquireSlot();
    try {
      const host = await this.resolveHost(hostInfo.id, hostInfo.userId);
      if (!host) return null;
      const key = `${hostInfo.userId}:${hostInfo.id}`;
      const state = this.failures.get(key);
      if (state && state.nextTry > this.now().getTime()) {
        return {
          hostId: hostInfo.id,
          status: "offline",
          observed: 0,
          adopted: 0,
          missing: 0,
          hibernated: 0,
          thawed: 0,
        };
      }
      if (!(await this.reachability(host, FAST_GATE_TIMEOUT_MS))) {
        this.recordFailure(key, hostInfo.id, "availability gate");
        return {
          hostId: hostInfo.id,
          status: "offline",
          observed: 0,
          adopted: 0,
          missing: 0,
          hibernated: 0,
          thawed: 0,
        };
      }

      const hostResult: PersistentSessionHostResult = {
        hostId: hostInfo.id,
        status: "online",
        observed: 0,
        adopted: 0,
        missing: 0,
        hibernated: 0,
        thawed: 0,
      };
      let remote;
      try {
        remote = await this.gateway.list(host, { timeoutMs: 10_000 });
      } catch (error) {
        this.recordFailure(
          key,
          hostInfo.id,
          error instanceof Error ? error.message : "remote unavailable",
        );
        hostResult.status = "offline";
        return hostResult;
      }
      const previousFailure = this.failures.get(key);
      if (previousFailure) {
        systemLogger.info("Persistent-session reconciliation host recovered", {
          operation: "persistent_session_reconcile_recovered",
          hostId: hostInfo.id,
        });
      }
      this.failures.delete(key);
      this.remoteSnapshots.set(key, remote);
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
          hostResult.missing++;
        } else if (observed.marker?.id === row.id) {
          await this.repository.touchLastObserved(row.id, timestamp);
          await this.applyHibernationPolicy(
            host,
            row,
            observed,
            hostInfo.userId,
            hostResult,
          );
        } else {
          await this.repository.recordEvent(row.id, "marker_mismatch", {
            actorId: hostInfo.userId,
          });
        }
      }
      for (const observed of remote) {
        if (
          await this.repository.findActiveByHostAndTmux(
            hostInfo.id,
            observed.name,
          )
        )
          continue;
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
            const marked = (
              await this.gateway.list(host, { timeoutMs: 10_000 })
            ).find((session) => session.name === observed.name);
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
            hostResult.adopted++;
          } catch (error) {
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
            expiryMode: "manual",
            expirySeconds: null,
            remoteCreatedAt: createdAt,
          },
          "recovered",
        );
        this.recoveredCounts.set(
          hostResult,
          (this.recoveredCounts.get(hostResult) ?? 0) + 1,
        );
      }
      return hostResult;
    } finally {
      this.activeHosts -= 1;
    }
  }

  private recordFailure(key: string, hostId: number, reason: string): void {
    const previous = this.failures.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const tier = Math.min(failures - 1, BACKOFF_MS.length - 1);
    const jitter = Math.floor(Math.random() * 5_000);
    this.failures.set(key, {
      failures,
      nextTry: this.now().getTime() + BACKOFF_MS[tier] + jitter,
      lastLog: this.now().getTime(),
    });
    const previousTier = previous
      ? Math.min(previous.failures - 1, BACKOFF_MS.length - 1)
      : -1;
    if (!previous || previousTier !== tier) {
      systemLogger.warn("Persistent-session reconciliation host unavailable", {
        operation: "persistent_session_reconcile_backoff",
        hostId,
        tier,
        reason,
      });
    }
  }

  private async applyHibernationPolicy(
    host: SSHHost,
    row: PersistentSessionRecord,
    observed: RemotePersistentSession,
    userId: string,
    result: PersistentSessionHostResult,
  ): Promise<void> {
    const idleHours = await this.getHibernateIdleHours();
    if (idleHours <= 0) return;

    // A browser transport or an attached tmux client always wins over the
    // inactivity clock. A hibernated session is woken before attach as a
    // second layer of defence by buildPersistentTmuxAttachCommand.
    const hasLiveClient =
      observed.attachedClients > 0 || this.attachedClients(row.id) > 0;
    if (row.hibernatedAt) {
      if (hasLiveClient) {
        await this.gateway.thaw(host, row.tmuxSessionName);
        await this.repository.setHibernatedAt(row.id, userId, null);
        result.thawed += 1;
        return;
      }
      // An attach thaws the panes inline (SIGCONT) and can detach before any
      // reconciler pass observes the client. Recent activity means the
      // session was used: clear the stale marker and let the idle clock run
      // again. Otherwise re-assert the freeze so a partially thawed session
      // still stops consuming CPU. SIGSTOP is idempotent.
      const activityAt = parseTmuxActivityAt(observed.activityAt);
      const idleMs = activityAt
        ? this.now().getTime() - activityAt.getTime()
        : null;
      if (idleMs !== null && idleMs < idleHours * 60 * 60 * 1000) {
        await this.repository.setHibernatedAt(row.id, userId, null);
        return;
      }
      await this.gateway.freeze(host, row.tmuxSessionName);
      return;
    }
    if (hasLiveClient) return;

    const activityAt = parseTmuxActivityAt(observed.activityAt);
    if (!activityAt) return;
    const idleMs = this.now().getTime() - activityAt.getTime();
    if (idleMs < idleHours * 60 * 60 * 1000) return;

    await this.gateway.freeze(host, row.tmuxSessionName);
    await this.repository.setHibernatedAt(
      row.id,
      userId,
      this.now().toISOString(),
    );
    result.hibernated += 1;
  }

  private async getHibernateIdleHours(): Promise<number> {
    const now = this.now().getTime();
    if (this.hibernateHoursCache && this.hibernateHoursCache.expires > now)
      return this.hibernateHoursCache.value;
    const configured = await this.hibernateIdleHoursReader();
    const value = Number.isFinite(configured)
      ? Math.max(0, Math.min(configured, 24 * 365))
      : DEFAULT_IDLE_HIBERNATE_HOURS;
    this.hibernateHoursCache = {
      value,
      expires: now + HIBERNATE_HOURS_CACHE_MS,
    };
    return value;
  }
}

async function readConfiguredHours(): Promise<number> {
  // Keep settings infrastructure out of the reconciler's hot/test import
  // path. This only runs once per cache window in the production default.
  const { createCurrentSettingsRepository } =
    await import("../../database/repositories/factory.js");
  const raw = await createCurrentSettingsRepository().get(
    HIBERNATE_IDLE_HOURS_SETTING,
  );
  if (raw === null || raw.trim() === "") return DEFAULT_IDLE_HIBERNATE_HOURS;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_IDLE_HIBERNATE_HOURS;
}

function parseTmuxActivityAt(value: string | undefined): Date | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function probeTcpReachability(
  host: SSHHost,
  timeoutMs: number,
): Promise<boolean> {
  // Direct TCP probing cannot describe jump-host/proxy routes; let the
  // purpose-specific SSH operation perform those connections instead.
  if (
    !host.ip ||
    !host.port ||
    host.useSocks5 ||
    (host.jumpHosts && host.jumpHosts.length > 0)
  )
    return true;
  return new Promise((resolve) => {
    const socket = createConnection({
      host: host.ip.replace(/^\[|\]$/g, ""),
      port: host.port,
    });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}
