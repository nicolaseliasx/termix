import type { SSHHost } from "../../../types/index.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../ssh-client-factory.js";
import { withConnection } from "../ssh-connection-pool.js";
import { execCommand, withTmuxPath } from "../tmux/helper.js";
import {
  buildPersistentTmuxCreateCommand,
  buildPersistentTmuxKillCommand,
  buildPersistentTmuxListCommand,
  buildPersistentTmuxMarkCommand,
  buildPersistentTmuxRenameCommand,
  parsePersistentTmuxList,
} from "./tmux-adapter.js";
import type {
  PersistentSessionExpiryMode,
  RemotePersistentSession,
} from "./types.js";
import { PersistentSessionError } from "./errors.js";
import { sshLogger } from "../../utils/logger.js";

export interface PersistentSessionGateway {
  list(host: SSHHost): Promise<RemotePersistentSession[]>;
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
}
export class SshPersistentSessionGateway implements PersistentSessionGateway {
  private async execute(host: SSHHost, command: string): Promise<string> {
    try {
      return await withConnection(
        getFleetPoolKey(host),
        createFleetSshFactory(host),
        (client) => execCommand(client, withTmuxPath(command)),
      );
    } catch (error) {
      sshLogger.warn("Persistent session remote operation failed", {
        operation: "persistent_session_remote",
        hostId: host.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new PersistentSessionError("PERSISTENT_SESSION_REMOTE_UNAVAILABLE");
    }
  }
  async list(host: SSHHost): Promise<RemotePersistentSession[]> {
    return parsePersistentTmuxList(
      await this.execute(host, buildPersistentTmuxListCommand()),
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
}
