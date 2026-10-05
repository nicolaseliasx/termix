import { randomUUID } from "node:crypto";
import type { SSHHost } from "../../../types/index.js";
import type {
  PersistentSessionRecord,
  PersistentSessionRepository,
} from "../../database/repositories/persistent-session-repository.js";
import { resolveHostById } from "../host-resolver.js";
import { PersistentSessionError } from "./errors.js";
import type { PersistentSessionGateway } from "./gateway.js";
import type { RemotePersistentSession } from "./types.js";
import { validatePersistentSessionName } from "./types.js";

export type SessionCreateInput = {
  hostId: number;
  displayName: string;
  tmuxSessionName: string;
};
export type SessionPatchInput = {
  displayName?: string;
  tmuxSessionName?: string;
};

/**
 * Sessions never expire: they run until manually terminated. The remote
 * marker keeps a `manual` expiry mode purely for tmux marker compatibility.
 */
const NEVER_EXPIRES = "manual" as const;

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
      expiryMode: NEVER_EXPIRES,
    });
    this.marker(
      (await this.gateway.list(host)).find(
        (s) => s.name === input.tmuxSessionName,
      ),
      id,
    );
    // A local failure intentionally leaves the verified remote session intact; no compensating kill is safe here.
    return this.repository.create({
      id,
      userId,
      hostId: input.hostId,
      displayName: input.displayName.trim(),
      tmuxSessionName: input.tmuxSessionName,
      managementState: "managed",
      expiryMode: NEVER_EXPIRES,
      expirySeconds: null,
      remoteCreatedAt: createdAt,
    });
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
    const saved = await this.repository.update(id, userId, update);
    if (!saved)
      throw new PersistentSessionError("PERSISTENT_SESSION_NOT_FOUND");
    return saved;
  }
  async kill(
    id: string,
    userId: string,
    options: { force?: boolean } = {},
  ): Promise<PersistentSessionRecord> {
    const record = await this.get(id, userId);
    if (record.endedAt) return record;
    const host = await this.host(record.hostId, userId);
    // A force removal keeps the local record deletable even when the remote
    // host is gone forever: the row must not outlive the machine it points
    // at. Remote work is still attempted first, best effort.
    let listed: RemotePersistentSession[] | null = null;
    try {
      listed = await this.gateway.list(host);
    } catch (error) {
      if (!options.force) throw error;
    }
    const remote = listed?.find((s) => s.name === record.tmuxSessionName);
    let remoteKilled = false;
    if (remote) {
      if (remote.marker?.id === id) {
        try {
          await this.gateway.kill(host, record.tmuxSessionName, id);
          if (
            (await this.gateway.list(host)).some(
              (s) => s.name === record.tmuxSessionName,
            )
          )
            throw new PersistentSessionError(
              "PERSISTENT_SESSION_REMOTE_FAILED",
            );
          remoteKilled = true;
        } catch (error) {
          if (!options.force) throw error;
        }
      } else if (!remote.marker) {
        // A restored tmux session can lose its marker. The active local
        // record still owns the name; the remote command checks again that
        // no marker appeared between listing and killing.
        const owner = await this.repository.findActiveByHostAndTmux(
          record.hostId,
          record.tmuxSessionName,
        );
        if (owner?.id !== id) {
          if (!options.force)
            throw new PersistentSessionError(
              "PERSISTENT_SESSION_MARKER_MISMATCH",
            );
        } else {
          try {
            await this.gateway.killUnguarded(host, record.tmuxSessionName);
            if (
              (await this.gateway.list(host)).some(
                (s) => s.name === record.tmuxSessionName,
              )
            )
              throw new PersistentSessionError(
                "PERSISTENT_SESSION_REMOTE_FAILED",
              );
            remoteKilled = true;
          } catch (error) {
            if (!options.force) throw error;
            // Host flaked mid-force: still end the local record below.
          }
        }
      } else if (!options.force) {
        // The marker belongs to another record: never kill what we do not
        // own. Force still ends the stale local row without a remote kill.
        throw new PersistentSessionError("PERSISTENT_SESSION_MARKER_MISMATCH");
      }
    }
    const reason =
      remoteKilled || (listed !== null && !remote)
        ? "killed"
        : "killed-unreachable";
    return (await this.repository.markEnded(id, userId, reason))!;
  }
  async adopt(
    userId: string,
    input: {
      hostId: number;
      tmuxSessionName: string;
      displayName?: string;
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
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.gateway.mark(host, {
      name: input.tmuxSessionName,
      id,
      createdAt,
      expiryMode: NEVER_EXPIRES,
    });
    this.marker(
      (await this.gateway.list(host)).find(
        (s) => s.name === input.tmuxSessionName,
      ),
      id,
    );
    return this.repository.create(
      {
        id,
        userId,
        hostId: input.hostId,
        displayName: input.displayName?.trim() || input.tmuxSessionName,
        tmuxSessionName: input.tmuxSessionName,
        managementState: "managed",
        expiryMode: NEVER_EXPIRES,
        expirySeconds: null,
        remoteCreatedAt: remote.createdAt ?? createdAt,
      },
      "adopted",
    );
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
