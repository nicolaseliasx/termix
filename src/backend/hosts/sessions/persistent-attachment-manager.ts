import { randomUUID } from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
import type { PersistentSessionRecord } from "../../database/repositories/persistent-session-repository.js";
import { createCurrentPersistentSessionRepository } from "../../database/repositories/factory.js";
import { resolveHostById } from "../host-resolver.js";
import { createFleetSshFactory } from "../ssh-client-factory.js";
import { withTmuxPath } from "../tmux/helper.js";
import { sshLogger } from "../../utils/logger.js";
import { PersistentSessionRegistry } from "./registry.js";
import { buildPersistentTmuxAttachCommand } from "./tmux-adapter.js";
import type { PersistentSessionRole } from "./types.js";
import { validatePersistentSessionName } from "./types.js";

export interface PersistentAttachmentSocket {
  readonly readyState: number;
  send(data: string): void;
  close?(code?: number, reason?: string): void;
}

export interface PersistentAttachment {
  persistentSessionId: string;
  clientId: string;
  userId: string;
  role: PersistentSessionRole;
  /** Opaque lease identifying the transport that owns this client slot. */
  generation: string;
}

interface ActiveAttachment extends PersistentAttachment {
  hostId: number;
  socket: PersistentAttachmentSocket;
  connection: Client;
  stream: ClientChannel;
  cols: number;
  rows: number;
  intentionalClose: boolean;
  ready: boolean;
}

const ATTACH_READY_TIMEOUT_MS = 15_000;

export class PersistentAttachmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Dependencies = {
  getSession: (
    id: string,
    userId: string,
  ) => Promise<PersistentSessionRecord | null>;
  resolveHost: typeof resolveHostById;
  connect: typeof createFleetSshFactory;
};

const defaultDependencies: Dependencies = {
  getSession: (id, userId) =>
    createCurrentPersistentSessionRepository().findByIdForUser(id, userId),
  resolveHost: resolveHostById,
  connect: createFleetSshFactory,
};

/**
 * Owns only the per-device SSH/PTy bridges.  It intentionally never invokes a
 * tmux lifecycle operation: losing a browser is a local detach, not a remote
 * session deletion.
 */
export class PersistentAttachmentManager {
  private readonly registry = new PersistentSessionRegistry();
  private readonly attachments = new Map<string, ActiveAttachment>();
  /** Reservations exist while SSH transport creation is still asynchronous. */
  private readonly leases = new Map<string, string>();

  constructor(
    private readonly dependencies: Dependencies = defaultDependencies,
  ) {}

  private key(sessionId: string, clientId: string): string {
    return `${sessionId}:${clientId}`;
  }

  private send(socket: PersistentAttachmentSocket, message: object): void {
    // ws.OPEN is 1. Keeping the interface small also makes this manager easy
    // to exercise with fake sockets.
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  private async open(
    record: PersistentSessionRecord,
    attachment: PersistentAttachment,
    socket: PersistentAttachmentSocket,
    cols: number,
    rows: number,
    generation: string,
  ): Promise<ActiveAttachment> {
    if (!validatePersistentSessionName(record.tmuxSessionName)) {
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_INVALID_NAME",
        "Persistent session is unavailable",
      );
    }
    const host = await this.dependencies.resolveHost(
      record.hostId,
      attachment.userId,
    );
    if (!host) {
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_NOT_FOUND",
        "Persistent session is unavailable",
      );
    }
    const connection = await this.dependencies.connect(host, {
      readyTimeoutMs: 10_000,
    })();
    let stream: ClientChannel;
    try {
      stream = await new Promise<ClientChannel>((resolve, reject) => {
        connection.shell(
          { term: "xterm-256color", cols, rows },
          (error, channel) => {
            if (error || !channel)
              reject(error ?? new Error("Unable to create terminal"));
            else resolve(channel);
          },
        );
      });
      // Restore the proven interactive PTY path. Direct exec PTYs regressed
      // redraw behavior for tmux after reconnect/resize on some servers.
      stream.write(
        `exec ${withTmuxPath(
          buildPersistentTmuxAttachCommand(
            record.tmuxSessionName,
            attachment.role === "viewer",
          ),
        )}\n`,
      );
    } catch (error) {
      connection.end();
      throw error;
    }
    const active: ActiveAttachment = {
      ...attachment,
      hostId: record.hostId,
      socket,
      connection,
      stream,
      cols,
      rows,
      intentionalClose: false,
      ready: false,
    };
    const key = this.key(attachment.persistentSessionId, attachment.clientId);
    // A newer browser connection may have claimed this slot while the old
    // SSH connection was opening. Never publish the stale transport.
    if (this.leases.get(key) !== generation) {
      active.stream.destroy();
      active.connection.end();
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_STALE_ATTACHMENT",
        "A newer attachment replaced this connection",
      );
    }
    this.attachments.set(key, active);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new PersistentAttachmentError(
              "PERSISTENT_SESSION_NO_OUTPUT",
              "The remote tmux session did not produce terminal output",
            ),
          );
        }, ATTACH_READY_TIMEOUT_MS);
        const markReady = () => {
          if (active.ready) return;
          active.ready = true;
          clearTimeout(timeout);
          resolve();
        };
        const failBeforeReady = () => {
          if (active.ready) return;
          clearTimeout(timeout);
          reject(
            new PersistentAttachmentError(
              "PERSISTENT_SESSION_START_FAILED",
              "The remote tmux session could not be opened",
            ),
          );
        };
        stream.on("data", (chunk: Buffer) => {
          markReady();
          this.send(socket, { type: "data", data: chunk.toString("utf8") });
        });
        stream.on("close", () => {
          failBeforeReady();
          this.forget(active, true);
        });
        stream.on("error", () => {
          failBeforeReady();
          this.forget(active, true);
        });
        connection.on("close", () => {
          failBeforeReady();
          this.forget(active, true);
        });
      });
    } catch (error) {
      this.closeTransport(active);
      throw error;
    }
    sshLogger.info("Persistent session transport ready", {
      operation: "persistent_session_attach_ready",
      userId: attachment.userId,
      hostId: record.hostId,
      persistentSessionId: attachment.persistentSessionId,
      tmuxSessionName: record.tmuxSessionName,
    });
    return active;
  }

  private forget(active: ActiveAttachment, notifyClient = false): void {
    const key = this.key(active.persistentSessionId, active.clientId);
    if (
      this.attachments.get(key) !== active ||
      this.leases.get(key) !== active.generation
    )
      return;
    this.attachments.delete(key);
    this.leases.delete(key);
    this.registry.detach(active.persistentSessionId, active.clientId);
    if (notifyClient && !active.intentionalClose) {
      active.connection.end();
      sshLogger.warn("Persistent session transport closed", {
        operation: "persistent_session_transport_closed",
        userId: active.userId,
        persistentSessionId: active.persistentSessionId,
      });
    }
    if (notifyClient && !active.intentionalClose && active.ready) {
      this.send(active.socket, {
        type: "persistent_error",
        code: "PERSISTENT_SESSION_REMOTE_CLOSED",
        message: "The remote tmux session closed unexpectedly",
      });
      active.socket.close?.(1011, "Remote tmux session closed");
    }
  }

  private closeTransport(active: ActiveAttachment): void {
    const key = this.key(active.persistentSessionId, active.clientId);
    if (this.attachments.get(key) === active) {
      this.attachments.delete(key);
      if (this.leases.get(key) === active.generation) this.leases.delete(key);
    }
    active.intentionalClose = true;
    // Destroy first so a demoted writer cannot write while SSH shutdown is in
    // flight. Neither operation sends a tmux kill command.
    active.stream.destroy();
    active.connection.end();
  }

  /** Returns a live SSH transport for a user's persistent terminal on a host. */
  getConnectionForHost(userId: string, hostId: number): Client | null {
    for (const active of this.attachments.values()) {
      if (
        active.userId === userId &&
        active.hostId === hostId &&
        active.ready
      ) {
        return active.connection;
      }
    }
    return null;
  }

  async attach(input: {
    persistentSessionId: string;
    userId: string;
    socket: PersistentAttachmentSocket;
    clientId?: string;
    role?: PersistentSessionRole;
    cols: number;
    rows: number;
  }): Promise<PersistentAttachment> {
    const clientId = input.clientId?.trim() || randomUUID();
    const role = input.role ?? "writer";
    if (!input.persistentSessionId || !["writer", "viewer"].includes(role)) {
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_INVALID_REQUEST",
        "Invalid persistent session attachment",
      );
    }
    const key = this.key(input.persistentSessionId, clientId);
    const generation = randomUUID();
    // Claim the slot before any await. A replacement therefore wins even if
    // the previous connection has not finished opening yet.
    this.leases.set(key, generation);
    const previous = this.attachments.get(key);
    if (previous) this.closeTransport(previous);
    let record: PersistentSessionRecord | null;
    try {
      record = await this.dependencies.getSession(
        input.persistentSessionId,
        input.userId,
      );
    } catch (error) {
      if (this.leases.get(key) === generation) this.leases.delete(key);
      throw error;
    }
    if (!record || record.endedAt) {
      if (this.leases.get(key) === generation) this.leases.delete(key);
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_NOT_FOUND",
        "Persistent session is unavailable",
      );
    }
    const attachment: PersistentAttachment = {
      persistentSessionId: input.persistentSessionId,
      clientId,
      userId: input.userId,
      role,
      generation,
    };
    try {
      this.registry.attach(
        attachment.persistentSessionId,
        attachment.clientId,
        attachment.role,
      );
      await this.open(
        record,
        attachment,
        input.socket,
        input.cols,
        input.rows,
        generation,
      );
      return attachment;
    } catch (error) {
      if (this.leases.get(key) === generation) {
        this.leases.delete(key);
        this.registry.detach(
          attachment.persistentSessionId,
          attachment.clientId,
        );
      }
      if (error instanceof PersistentAttachmentError) throw error;
      if (
        error instanceof Error &&
        error.message === "PERSISTENT_SESSION_WRITER_CONFLICT"
      ) {
        throw new PersistentAttachmentError(
          "PERSISTENT_SESSION_WRITER_CONFLICT",
          "Another device controls this session",
        );
      }
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_CONNECT_FAILED",
        "Unable to attach persistent session",
      );
    }
  }

  detach(sessionId: string, clientId: string, generation?: string): void {
    const key = this.key(sessionId, clientId);
    if (generation && this.leases.get(key) !== generation) return;
    const active = this.attachments.get(key);
    if (active) this.closeTransport(active);
    this.leases.delete(key);
    this.registry.detach(sessionId, clientId);
  }

  canWrite(sessionId: string, clientId: string): boolean {
    return this.registry.canWrite(sessionId, clientId);
  }

  resize(
    sessionId: string,
    clientId: string,
    cols: number,
    rows: number,
  ): boolean {
    const active = this.attachments.get(this.key(sessionId, clientId));
    if (!active?.stream.setWindow) return false;
    active.stream.setWindow(rows, cols, rows, cols);
    active.cols = cols;
    active.rows = rows;
    return true;
  }

  write(sessionId: string, clientId: string, data: string): boolean {
    const active = this.attachments.get(this.key(sessionId, clientId));
    if (!active || !this.registry.canWrite(sessionId, clientId)) return false;
    active.stream.write(Buffer.from(data, "utf8"));
    return true;
  }

  async takeControl(
    sessionId: string,
    clientId: string,
  ): Promise<{ oldWriter?: string }> {
    const active = this.attachments.get(this.key(sessionId, clientId));
    if (!active)
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_NOT_ATTACHED",
        "Attach this device before taking control",
      );
    const oldWriter = this.registry.writerClientId(sessionId);
    if (oldWriter === clientId) return {};
    const old = oldWriter
      ? this.attachments.get(this.key(sessionId, oldWriter))
      : undefined;
    const record = await this.dependencies.getSession(sessionId, active.userId);
    if (!record || record.endedAt)
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_NOT_FOUND",
        "Persistent session is unavailable",
      );
    if (old) this.closeTransport(old);
    this.closeTransport(active);
    // closeTransport retires the old active transport; reserve its lease for
    // the replacement PTY opened below.
    this.leases.set(
      this.key(active.persistentSessionId, active.clientId),
      active.generation,
    );
    this.registry.takeControl(sessionId, clientId);
    try {
      await this.open(
        record,
        { ...active, role: "writer" },
        active.socket,
        active.cols,
        active.rows,
        active.generation,
      );
      if (old && old.socket.readyState === 1) {
        await this.open(
          record,
          { ...old, role: "viewer" },
          old.socket,
          old.cols,
          old.rows,
          old.generation,
        );
        this.send(old.socket, {
          type: "persistent_control_revoked",
          persistentSessionId: sessionId,
          clientId: old.clientId,
          role: "viewer",
        });
      }
    } catch (error) {
      if (
        this.leases.get(this.key(sessionId, clientId)) === active.generation
      ) {
        this.leases.delete(this.key(sessionId, clientId));
      }
      this.registry.detach(sessionId, clientId);
      throw error instanceof PersistentAttachmentError
        ? error
        : new PersistentAttachmentError(
            "PERSISTENT_SESSION_CONNECT_FAILED",
            "Unable to take control",
          );
    }
    return { oldWriter };
  }

  shutdown(): void {
    for (const active of [...this.attachments.values()])
      this.closeTransport(active);
    this.attachments.clear();
    this.leases.clear();
  }
}

export const persistentAttachmentManager = new PersistentAttachmentManager();
