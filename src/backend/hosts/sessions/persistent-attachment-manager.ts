import { randomUUID } from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
import type { PersistentSessionRecord } from "../../database/repositories/persistent-session-repository.js";
import { createCurrentPersistentSessionRepository } from "../../database/repositories/factory.js";
import { resolveHostById } from "../host-resolver.js";
import { createFleetSshFactory } from "../ssh-client-factory.js";
import { PersistentSessionRegistry } from "./registry.js";
import type { PersistentSessionRole } from "./types.js";
import { validatePersistentSessionName } from "./types.js";

export interface PersistentAttachmentSocket {
  readonly readyState: number;
  send(data: string): void;
}

export interface PersistentAttachment {
  persistentSessionId: string;
  clientId: string;
  userId: string;
  role: PersistentSessionRole;
}

interface ActiveAttachment extends PersistentAttachment {
  socket: PersistentAttachmentSocket;
  connection: Client;
  stream: ClientChannel;
  cols: number;
  rows: number;
}

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
    const connection = await this.dependencies.connect(host)();
    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      connection.shell(
        { term: "xterm-256color", cols, rows },
        (error, channel) => {
          if (error || !channel)
            reject(error ?? new Error("Unable to create terminal"));
          else resolve(channel);
        },
      );
    });
    const active: ActiveAttachment = {
      ...attachment,
      socket,
      connection,
      stream,
      cols,
      rows,
    };
    this.attachments.set(
      this.key(attachment.persistentSessionId, attachment.clientId),
      active,
    );
    stream.on("data", (chunk: Buffer) =>
      this.send(socket, { type: "data", data: chunk.toString("utf8") }),
    );
    stream.on("close", () => this.forget(active));
    stream.on("error", () => this.forget(active));
    connection.on("close", () => this.forget(active));
    // exec keeps the channel coupled to tmux.  `-r` is deliberately used only
    // for viewers; there is no tmux control mode and no shared local PTY.
    stream.write(
      `exec tmux attach-session ${attachment.role === "viewer" ? "-r " : ""}-t ${record.tmuxSessionName}\n`,
    );
    return active;
  }

  private forget(active: ActiveAttachment): void {
    const key = this.key(active.persistentSessionId, active.clientId);
    if (this.attachments.get(key) !== active) return;
    this.attachments.delete(key);
    this.registry.detach(active.persistentSessionId, active.clientId);
  }

  private closeTransport(active: ActiveAttachment): void {
    const key = this.key(active.persistentSessionId, active.clientId);
    if (this.attachments.get(key) === active) this.attachments.delete(key);
    // Destroy first so a demoted writer cannot write while SSH shutdown is in
    // flight. Neither operation sends a tmux kill command.
    active.stream.destroy();
    active.connection.end();
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
    if (this.attachments.has(key)) {
      throw new PersistentAttachmentError(
        "PERSISTENT_SESSION_DUPLICATE_CLIENT",
        "This device is already attached",
      );
    }
    const record = await this.dependencies.getSession(
      input.persistentSessionId,
      input.userId,
    );
    if (!record || record.endedAt) {
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
    };
    try {
      this.registry.attach(
        attachment.persistentSessionId,
        attachment.clientId,
        attachment.role,
      );
      await this.open(record, attachment, input.socket, input.cols, input.rows);
      return attachment;
    } catch (error) {
      this.registry.detach(attachment.persistentSessionId, attachment.clientId);
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

  detach(sessionId: string, clientId: string): void {
    const active = this.attachments.get(this.key(sessionId, clientId));
    if (active) this.closeTransport(active);
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
    this.registry.takeControl(sessionId, clientId);
    try {
      await this.open(
        record,
        { ...active, role: "writer" },
        active.socket,
        active.cols,
        active.rows,
      );
      if (old && old.socket.readyState === 1) {
        await this.open(
          record,
          { ...old, role: "viewer" },
          old.socket,
          old.cols,
          old.rows,
        );
        this.send(old.socket, {
          type: "persistent_control_revoked",
          persistentSessionId: sessionId,
          clientId: old.clientId,
          role: "viewer",
        });
      }
    } catch (error) {
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
  }
}

export const persistentAttachmentManager = new PersistentAttachmentManager();
