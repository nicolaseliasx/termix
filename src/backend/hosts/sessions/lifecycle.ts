import { randomUUID } from "node:crypto";
import type { SSHHost } from "../../../types/index.js";
import type {
  PersistentSessionRecord,
  PersistentSessionRepository,
} from "../../database/repositories/persistent-session-repository.js";
import { resolveHostById } from "../host-resolver.js";
import { PersistentSessionError } from "./errors.js";
import type { PersistentSessionGateway } from "./gateway.js";
import type {
  PersistentSessionExpiryMode,
  RemotePersistentSession,
} from "./types.js";
import {
  DEFAULT_IDLE_EXPIRY_SECONDS,
  validateIdleExpiry,
  validatePersistentSessionName,
} from "./types.js";

export type SessionCreateInput = {
  hostId: number;
  displayName: string;
  tmuxSessionName: string;
  expiryMode?: PersistentSessionExpiryMode;
  expirySeconds?: number;
};
export type SessionPatchInput = {
  displayName?: string;
  tmuxSessionName?: string;
  expiryMode?: PersistentSessionExpiryMode;
  expirySeconds?: number;
};

export class PersistentSessionLifecycleService {
  constructor(
    private readonly repository: PersistentSessionRepository,
    private readonly gateway: PersistentSessionGateway,
    private readonly resolveHost: (
      hostId: number,
      userId: string,
    ) => Promise<SSHHost | null> = resolveHostById,
  ) {}
  private async host(hostId: number, userId: string): Promise<SSHHost> {
    const host = await this.resolveHost(hostId, userId);
    if (!host) throw new PersistentSessionError("PERSISTENT_SESSION_NOT_FOUND");
    return host;
  }
  /**
   * Resolves the expiry policy. Omitted fields default to idle/6h so a
   * bare create call keeps the session for a working day after detach;
   * explicit values are still validated as before.
   */
  private policy(
    mode?: PersistentSessionExpiryMode,
    seconds?: number,
  ): {
    mode: PersistentSessionExpiryMode;
    seconds?: number;
    expiresAt: string | null;
  } {
    const resolvedMode = mode ?? "idle";
    if (resolvedMode !== "manual" && resolvedMode !== "idle")
      throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_EXPIRY");
    const resolvedSeconds =
      resolvedMode === "idle" && seconds === undefined
        ? DEFAULT_IDLE_EXPIRY_SECONDS
        : seconds;
    if (resolvedMode === "idle" && !validateIdleExpiry(resolvedSeconds))
      throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_EXPIRY");
    return {
      mode: resolvedMode,
      seconds: resolvedMode === "idle" ? resolvedSeconds : undefined,
      expiresAt:
        resolvedMode === "idle"
          ? new Date(Date.now() + resolvedSeconds! * 1000).toISOString()
          : null,
    };
  }
  private marker(
    remote: RemotePersistentSession | undefined,
    id: string,
  ): void {
    if (!remote || remote.marker?.id !== id)
      throw new PersistentSessionError("PERSISTENT_SESSION_MARKER_MISMATCH");
  }
  async list(userId: string, limit = 50, offset = 0, includeEnded = false) {
    return this.repository.listByUser(userId, { limit, offset, includeEnded });
  }
  async get(id: string, userId: string): Promise<PersistentSessionRecord> {
    const record = await this.repository.findByIdForUser(id, userId);
    if (!record)
      throw new PersistentSessionError("PERSISTENT_SESSION_NOT_FOUND");
    return record;
  }
  async create(
    userId: string,
    input: SessionCreateInput,
  ): Promise<PersistentSessionRecord> {
    if (!validatePersistentSessionName(input.tmuxSessionName))
      throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_NAME");
    if (typeof input.displayName !== "string" || !input.displayName.trim())
      throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_REQUEST");
    const policy = this.policy(input.expiryMode, input.expirySeconds);
    const host = await this.host(input.hostId, userId);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const conflict = await this.repository.findActiveByHostAndTmux(
      input.hostId,
      input.tmuxSessionName,
    );
    if (conflict)
      throw new PersistentSessionError("PERSISTENT_SESSION_CONFLICT");
    await this.gateway.create(host, {
      name: input.tmuxSessionName,
      id,
      createdAt,
      expiryMode: policy.mode,
      expirySeconds: policy.seconds,
    });
    this.marker(
      (await this.gateway.list(host)).find(
        (s) => s.name === input.tmuxSessionName,
      ),
      id,
    );
    // A local failure intentionally leaves the verified remote session intact; no compensating kill is safe here.
    const record = await this.repository.create({
      id,
      userId,
      hostId: input.hostId,
      displayName: input.displayName.trim(),
      tmuxSessionName: input.tmuxSessionName,
      managementState: "managed",
      expiryMode: policy.mode,
      expirySeconds: policy.seconds ?? null,
      remoteCreatedAt: createdAt,
    });
    if (policy.expiresAt)
      return (await this.repository.update(id, userId, {
        expiresAt: policy.expiresAt,
      }))!;
    return record;
  }
  async patch(
    id: string,
    userId: string,
    patch: SessionPatchInput,
  ): Promise<PersistentSessionRecord> {
    const record = await this.get(id, userId);
    const host = await this.host(record.hostId, userId);
    const update: Parameters<PersistentSessionRepository["update"]>[2] = {};
    if (patch.displayName !== undefined) {
      if (!patch.displayName.trim())
        throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_REQUEST");
      update.displayName = patch.displayName.trim();
    }
    if (
      patch.tmuxSessionName !== undefined &&
      patch.tmuxSessionName !== record.tmuxSessionName
    ) {
      if (!validatePersistentSessionName(patch.tmuxSessionName))
        throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_NAME");
      await this.gateway.rename(host, {
        oldName: record.tmuxSessionName,
        newName: patch.tmuxSessionName,
        id,
      });
      this.marker(
        (await this.gateway.list(host)).find(
          (s) => s.name === patch.tmuxSessionName,
        ),
        id,
      );
      update.tmuxSessionName = patch.tmuxSessionName;
    }
    if (patch.expiryMode !== undefined || patch.expirySeconds !== undefined) {
      const policy = this.policy(
        patch.expiryMode ?? (record.expiryMode as PersistentSessionExpiryMode),
        patch.expirySeconds ?? record.expirySeconds ?? undefined,
      );
      update.expiryMode = policy.mode;
      update.expirySeconds = policy.seconds ?? null;
      update.expiresAt = policy.expiresAt;
    }
    const saved = await this.repository.update(id, userId, update);
    if (!saved)
      throw new PersistentSessionError("PERSISTENT_SESSION_NOT_FOUND");
    return saved;
  }
  async kill(id: string, userId: string): Promise<PersistentSessionRecord> {
    const record = await this.get(id, userId);
    if (record.endedAt) return record;
    const host = await this.host(record.hostId, userId);
    const remote = (await this.gateway.list(host)).find(
      (s) => s.name === record.tmuxSessionName,
    );
    if (remote) {
      this.marker(remote, id);
      await this.gateway.kill(host, record.tmuxSessionName, id);
      if (
        (await this.gateway.list(host)).some(
          (s) => s.name === record.tmuxSessionName,
        )
      )
        throw new PersistentSessionError("PERSISTENT_SESSION_REMOTE_FAILED");
    }
    return (await this.repository.markEnded(id, userId, "killed"))!;
  }
  async adopt(
    userId: string,
    input: {
      hostId: number;
      tmuxSessionName: string;
      displayName?: string;
      expiryMode?: PersistentSessionExpiryMode;
      expirySeconds?: number;
    },
  ): Promise<PersistentSessionRecord> {
    if (!validatePersistentSessionName(input.tmuxSessionName))
      throw new PersistentSessionError("PERSISTENT_SESSION_INVALID_NAME");
    const host = await this.host(input.hostId, userId);
    const remote = (await this.gateway.list(host)).find(
      (s) => s.name === input.tmuxSessionName,
    );
    if (!remote)
      throw new PersistentSessionError("PERSISTENT_SESSION_NOT_FOUND");
    if (remote.marker)
      throw new PersistentSessionError("PERSISTENT_SESSION_CONFLICT");
    const policy = this.policy(input.expiryMode, input.expirySeconds);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.gateway.mark(host, {
      name: input.tmuxSessionName,
      id,
      createdAt,
      expiryMode: policy.mode,
      expirySeconds: policy.seconds,
    });
    this.marker(
      (await this.gateway.list(host)).find(
        (s) => s.name === input.tmuxSessionName,
      ),
      id,
    );
    const record = await this.repository.create(
      {
        id,
        userId,
        hostId: input.hostId,
        displayName: input.displayName?.trim() || input.tmuxSessionName,
        tmuxSessionName: input.tmuxSessionName,
        managementState: "managed",
        expiryMode: policy.mode,
        expirySeconds: policy.seconds ?? null,
        remoteCreatedAt: remote.createdAt ?? createdAt,
      },
      "adopted",
    );
    if (policy.expiresAt)
      return (await this.repository.update(id, userId, {
        expiresAt: policy.expiresAt,
      }))!;
    return record;
  }
  async refresh(
    hostId: number,
    userId: string,
  ): Promise<{
    sessions: RemotePersistentSession[];
    discovered: RemotePersistentSession[];
  }> {
    const host = await this.host(hostId, userId);
    const remote = await this.gateway.list(host);
    const current = await this.repository.listActiveByHostForUser(
      hostId,
      userId,
    );
    const now = new Date().toISOString();
    for (const row of current) {
      const found = remote.find((s) => s.name === row.tmuxSessionName);
      if (!found)
        await this.repository.markEnded(row.id, userId, "disappeared");
      else if (found.marker?.id === row.id)
        await this.repository.update(row.id, userId, { lastObservedAt: now });
    }
    return { sessions: remote, discovered: remote.filter((s) => !s.marker) };
  }
}
