import { describe, expect, it } from "vitest";
import {
  buildPersistentTmuxCreateCommand,
  buildPersistentTmuxKillCommand,
  buildPersistentTmuxListCommand,
  parsePersistentTmuxList,
} from "../../../hosts/sessions/tmux-adapter.js";

describe("persistent tmux adapter", () => {
  const input = {
    name: "safe-session",
    id: "session-id",
    createdAt: "2026-08-26T00:00:00.000Z",
    expiryMode: "manual" as const,
  };
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
