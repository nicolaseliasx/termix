import type { SSHHost } from "../../../types/index.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../ssh-client-factory.js";
import { withConnection } from "../ssh-connection-pool.js";
import { execCommand, withTmuxPath } from "../tmux/helper.js";
import {
  buildPersistentTmuxCreateCommand,
  buildPersistentTmuxFreezeCommand,
  buildPersistentTmuxKillByNameCommand,
  buildPersistentTmuxKillCommand,
  buildPersistentTmuxListCommand,
  buildPersistentTmuxMarkCommand,
  buildPersistentTmuxRenameCommand,
  buildPersistentTmuxThawCommand,
  parsePersistentTmuxList,
} from "./tmux-adapter.js";
import type {
  PersistentSessionExpiryMode,
  RemotePersistentSession,
} from "./types.js";
import { PersistentSessionError } from "./errors.js";
import { sshLogger } from "../../utils/logger.js";

export interface PersistentSessionGateway {
  list(
    host: SSHHost,
    options?: { timeoutMs?: number },
  ): Promise<RemotePersistentSession[]>;
  create(
    host: SSHHost,
    input: {
      name: string;
      id: string;
      createdAt: string;
      expiryMode: PersistentSessionExpiryMode;
      expirySeconds?: number;
    },
  ): Promise<void>;
  mark(
    host: SSHHost,
    input: {
      name: string;
      id: string;
      createdAt: string;
      expiryMode: PersistentSessionExpiryMode;
      expirySeconds?: number;
    },
  ): Promise<void>;
  rename(
    host: SSHHost,
    input: { oldName: string; newName: string; id: string },
  ): Promise<void>;
  kill(host: SSHHost, name: string, id: string): Promise<void>;
  /** Kills by session name only; only for sessions no record can own. */
  killUnguarded(host: SSHHost, name: string): Promise<void>;
  freeze(host: SSHHost, name: string): Promise<void>;
  thaw(host: SSHHost, name: string): Promise<void>;
}
export class SshPersistentSessionGateway implements PersistentSessionGateway {
  private async execute(
    host: SSHHost,
    command: string,
    timeoutMs = 30_000,
  ): Promise<string> {
    try {
      const operation = withConnection(
        getFleetPoolKey(host),
        createFleetSshFactory(host, { readyTimeoutMs: timeoutMs }),
        (client) => execCommand(client, withTmuxPath(command)),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<string>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Persistent session SSH timeout")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      sshLogger.warn("Persistent session remote operation failed", {
        operation: "persistent_session_remote",
        hostId: host.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new PersistentSessionError("PERSISTENT_SESSION_REMOTE_UNAVAILABLE");
    }
  }
  async list(
    host: SSHHost,
    options?: { timeoutMs?: number },
  ): Promise<RemotePersistentSession[]> {
    return parsePersistentTmuxList(
      await this.execute(
        host,
        buildPersistentTmuxListCommand(),
        options?.timeoutMs,
      ),
    );
  }
  async create(
    host: SSHHost,
    input: Parameters<PersistentSessionGateway["create"]>[1],
  ): Promise<void> {
    await this.execute(host, buildPersistentTmuxCreateCommand(input));
  }
  async mark(
    host: SSHHost,
    input: Parameters<PersistentSessionGateway["mark"]>[1],
  ): Promise<void> {
    await this.execute(host, buildPersistentTmuxMarkCommand(input));
  }
  async rename(
    host: SSHHost,
    input: Parameters<PersistentSessionGateway["rename"]>[1],
  ): Promise<void> {
    await this.execute(host, buildPersistentTmuxRenameCommand(input));
  }
  async kill(host: SSHHost, name: string, id: string): Promise<void> {
    await this.execute(host, buildPersistentTmuxKillCommand(name, id));
  }
  async killUnguarded(host: SSHHost, name: string): Promise<void> {
    await this.execute(host, buildPersistentTmuxKillByNameCommand(name));
  }
  async freeze(host: SSHHost, name: string): Promise<void> {
    await this.execute(host, buildPersistentTmuxFreezeCommand(name));
  }
  async thaw(host: SSHHost, name: string): Promise<void> {
    await this.execute(host, buildPersistentTmuxThawCommand(name));
  }
}
