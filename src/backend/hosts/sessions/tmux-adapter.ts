import type {
  PersistentSessionExpiryMode,
  PersistentSessionMarker,
  RemotePersistentSession,
} from "./types.js";
import { validatePersistentSessionName } from "./types.js";

/** Quote exactly once at the SSH shell boundary. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`;
}

function target(name: string): string {
  if (!validatePersistentSessionName(name))
    throw new Error("PERSISTENT_SESSION_INVALID_NAME");
  return shellQuote(name);
}

/** This command never appends `exit`; PTY closure must not terminate tmux. */
export function buildPersistentTmuxCreateCommand(input: {
  name: string;
  id: string;
  createdAt: string;
  expiryMode: PersistentSessionExpiryMode;
  expirySeconds?: number;
}): string {
  if (!validatePersistentSessionName(input.name))
    throw new Error("PERSISTENT_SESSION_INVALID_NAME");
  const set = (key: string, value: string) =>
    `tmux set-option -t ${target(input.name)} -q ${shellQuote(key)} ${shellQuote(value)}`;
  const commands = [
    `tmux new-session -d -s ${shellQuote(input.name)}`,
    set("@termix_session_id", input.id),
    set("@termix_created_at", input.createdAt),
    set("@termix_expiry_mode", input.expiryMode),
  ];
  if (input.expirySeconds !== undefined)
    commands.push(set("@termix_expiry_seconds", String(input.expirySeconds)));
  return commands.join(" && ");
}

export function buildPersistentTmuxAttachCommand(
  name: string,
  readOnly: boolean,
): string {
  return `tmux attach-session ${readOnly ? "-r " : ""}-t ${target(name)}`;
}

export function buildPersistentTmuxKillCommand(
  name: string,
  id: string,
): string {
  return `test "$(tmux show-option -t ${target(name)} -qv @termix_session_id)" = ${shellQuote(id)} && tmux kill-session -t ${target(name)} && ! tmux has-session -t ${target(name)}`;
}

export function buildPersistentTmuxMarkCommand(input: {
  name: string;
  id: string;
  createdAt: string;
  expiryMode: PersistentSessionExpiryMode;
  expirySeconds?: number;
}): string {
  if (!validatePersistentSessionName(input.name))
    throw new Error("PERSISTENT_SESSION_INVALID_NAME");
  const set = (key: string, value: string) =>
    `tmux set-option -t ${target(input.name)} -q ${shellQuote(key)} ${shellQuote(value)}`;
  const commands = [
    `tmux has-session -t ${target(input.name)}`,
    set("@termix_session_id", input.id),
    set("@termix_created_at", input.createdAt),
    set("@termix_expiry_mode", input.expiryMode),
  ];
  if (input.expirySeconds !== undefined)
    commands.push(set("@termix_expiry_seconds", String(input.expirySeconds)));
  return commands.join(" && ");
}

export function buildPersistentTmuxRenameCommand(input: {
  oldName: string;
  newName: string;
  id: string;
}): string {
  if (
    !validatePersistentSessionName(input.oldName) ||
    !validatePersistentSessionName(input.newName)
  )
    throw new Error("PERSISTENT_SESSION_INVALID_NAME");
  return `test "$(tmux show-option -t ${target(input.oldName)} -qv @termix_session_id)" = ${shellQuote(input.id)} && tmux rename-session -t ${target(input.oldName)} ${shellQuote(input.newName)} && test "$(tmux show-option -t ${target(input.newName)} -qv @termix_session_id)" = ${shellQuote(input.id)}`;
}

export function buildPersistentTmuxListCommand(): string {
  return "command -v tmux >/dev/null 2>&1 || exit 127; tmux list-sessions -F '#{session_name}\t#{session_created}\t#{session_activity}\t#{session_attached}\t#{@termix_session_id}\t#{@termix_created_at}\t#{@termix_expiry_mode}\t#{@termix_expiry_seconds}' 2>/dev/null || true";
}

export function parsePersistentTmuxList(
  output: string,
): RemotePersistentSession[] {
  const names = new Set<string>();
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const [
      name,
      createdAt,
      activityAt,
      attached,
      id,
      markedAt,
      expiryMode,
      expirySeconds,
    ] = line.split("\t");
    if (!validatePersistentSessionName(name) || names.has(name)) return [];
    names.add(name);
    const count = Number(attached);
    const marker =
      id && markedAt && (expiryMode === "manual" || expiryMode === "idle")
        ? ({
            id,
            createdAt: markedAt,
            expiryMode,
            ...(expirySeconds && Number.isFinite(Number(expirySeconds))
              ? { expirySeconds: Number(expirySeconds) }
              : {}),
          } as PersistentSessionMarker)
        : undefined;
    return [
      {
        name,
        createdAt: createdAt || undefined,
        activityAt: activityAt || undefined,
        attachedClients: Number.isInteger(count) && count >= 0 ? count : 0,
        marker,
      },
    ];
  });
}
