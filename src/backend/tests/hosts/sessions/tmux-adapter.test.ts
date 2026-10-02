import { describe, expect, it } from "vitest";
import {
  buildPersistentTmuxAttachCommand,
  buildPersistentTmuxCreateCommand,
  buildPersistentTmuxFreezeCommand,
  buildPersistentTmuxHasSessionCommand,
  buildPersistentTmuxKillCommand,
  buildPersistentTmuxListCommand,
  buildPersistentTmuxThawCommand,
  parsePersistentTmuxList,
} from "../../../hosts/sessions/tmux-adapter.js";

describe("persistent tmux adapter", () => {
  const input = {
    name: "safe-session",
    id: "session-id",
    createdAt: "2026-08-26T00:00:00.000Z",
    expiryMode: "manual" as const,
  };
  it("builds validated UTF-8 attach and preflight commands", () => {
    expect(buildPersistentTmuxHasSessionCommand(input.name)).toBe(
      "tmux has-session -t 'safe-session'",
    );
    expect(buildPersistentTmuxAttachCommand(input.name, true)).toContain(
      "kill -CONT",
    );
    expect(buildPersistentTmuxAttachCommand(input.name, true)).toContain(
      "tmux -u attach-session -r -t 'safe-session'",
    );
  });
  it("signals pane process groups without ever signalling the tmux server", () => {
    const freeze = buildPersistentTmuxFreezeCommand(input.name);
    const thaw = buildPersistentTmuxThawCommand(input.name);
    expect(freeze).toContain("tmux list-panes -a -t 'safe-session'");
    expect(freeze).toContain('kill -STOP "-$pgid"');
    expect(thaw).toContain('kill -CONT "-$pgid"');
    expect(freeze).not.toContain("kill -STOP tmux");
  });
  it("also sweeps process groups created by interactive pane jobs", () => {
    const freeze = buildPersistentTmuxFreezeCommand(input.name);
    const thaw = buildPersistentTmuxThawCommand(input.name);
    // Interactive shells give every job its own process group; only the
    // pane leader's group would be stopped without the session sweep.
    expect(freeze).toContain("ps -eo sid=,pgid=");
    expect(freeze).toContain('awk -v s="$pid"');
    expect(freeze).toContain('kill -STOP "-$pg" 2>/dev/null');
    expect(thaw).toContain('kill -CONT "-$pg" 2>/dev/null');
  });
  it("builds the create command without a working directory", () => {
    const command = buildPersistentTmuxCreateCommand(input);
    expect(command).toContain("tmux new-session -d -s 'safe-session'");
    expect(command).not.toContain(" -c ");
    expect(command).not.toContain("@termix_expiry_seconds");
  });
  it("requires marker equality and confirms kill", () => {
    const command = buildPersistentTmuxKillCommand(input.name, input.id);
    expect(command).toContain("@termix_session_id");
    expect(command).toContain("-t 'safe-session'");
    expect(command).not.toContain("-t '=safe-session'");
    expect(command).toContain("! tmux has-session");
  });
  it("lists zero sessions without treating an idle tmux server as offline", () => {
    const command = buildPersistentTmuxListCommand();
    expect(command).toContain("command -v tmux");
    expect(command).toContain("list-sessions");
    expect(command).toContain("2>/dev/null || true");
    expect(command).toContain("#{session_name}\t#{session_created}");
    expect(command).not.toContain("#{session_name}\\t#{session_created}");
  });
  it("retains valid markers and ignores duplicate names", () => {
    const [session] = parsePersistentTmuxList(
      "safe-session\t1\t2\t0\tsession-id\t2026-08-26T00:00:00.000Z\tidle\t300\nsafe-session\t1\t2\t0\tother\tdate\tmanual\t",
    );
    expect(session).toMatchObject({
      name: "safe-session",
      marker: { id: "session-id", expirySeconds: 300 },
    });
  });
});
