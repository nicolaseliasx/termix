import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  PersistentAttachmentManager,
  PersistentAttachmentError,
} from "../../../hosts/sessions/persistent-attachment-manager.js";

class FakeStream extends EventEmitter {
  readonly writes: string[] = [];
  destroyed = false;
  setWindowCalls: Array<[number, number]> = [];
  write(data: Buffer | string) {
    this.writes.push(data.toString());
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
  setWindow(rows: number, cols: number) {
    this.setWindowCalls.push([rows, cols]);
  }
}

class FakeClient extends EventEmitter {
  readonly stream = new FakeStream();
  ended = false;
  shell(
    _options: unknown,
    callback: (error?: Error, stream?: FakeStream) => void,
  ) {
    callback(undefined, this.stream);
  }
  end() {
    this.ended = true;
    this.emit("close");
  }
}

function setup() {
  const clients: FakeClient[] = [];
  const manager = new PersistentAttachmentManager({
    getSession: async () =>
      ({
        id: "session",
        hostId: 7,
        tmuxSessionName: "termix-persist",
        endedAt: null,
      }) as never,
    resolveHost: async () => ({ id: 7 }) as never,
    connect: () => async () => {
      const client = new FakeClient();
      clients.push(client);
      return client as never;
    },
  } as never);
  const socket = () => ({
    readyState: 1,
    messages: [] as string[],
    send(data: string) {
      this.messages.push(data);
    },
  });
  return { manager, clients, socket };
}

describe("PersistentAttachmentManager", () => {
  it("uses an isolated read-only PTY for viewers and rejects forged input", async () => {
    const { manager, clients, socket } = setup();
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: socket(),
      clientId: "writer",
      role: "writer",
      cols: 80,
      rows: 24,
    });
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: socket(),
      clientId: "viewer",
      role: "viewer",
      cols: 90,
      rows: 30,
    });
    expect(clients).toHaveLength(2);
    expect(clients[1].stream.writes[0]).toContain(
      "attach-session -r -t termix-persist",
    );
    expect(manager.write("session", "viewer", "forged")).toBe(false);
    expect(manager.resize("session", "viewer", 100, 40)).toBe(true);
    expect(clients[1].stream.setWindowCalls).toEqual([[40, 100]]);
  });

  it("enforces one writer, then closes it before takeover and demotes it", async () => {
    const { manager, clients, socket } = setup();
    const oldSocket = socket();
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: oldSocket,
      clientId: "writer",
      role: "writer",
      cols: 80,
      rows: 24,
    });
    await expect(
      manager.attach({
        persistentSessionId: "session",
        userId: "owner",
        socket: socket(),
        clientId: "other",
        role: "writer",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_WRITER_CONFLICT",
    } satisfies Partial<PersistentAttachmentError>);
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: socket(),
      clientId: "viewer",
      role: "viewer",
      cols: 80,
      rows: 24,
    });
    await manager.takeControl("session", "viewer");
    expect(clients[0].stream.destroyed).toBe(true);
    expect(
      clients.some((client) =>
        client.stream.writes.some((write) =>
          write.includes("attach-session -r -t termix-persist"),
        ),
      ),
    ).toBe(true);
    expect(
      oldSocket.messages.some((message) =>
        message.includes("persistent_control_revoked"),
      ),
    ).toBe(true);
  });

  it("disconnects only local bridges and never sends a tmux kill command", async () => {
    const { manager, clients, socket } = setup();
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: socket(),
      clientId: "writer",
      role: "writer",
      cols: 80,
      rows: 24,
    });
    manager.detach("session", "writer");
    expect(clients[0].ended).toBe(true);
    expect(clients[0].stream.writes.join("\n")).not.toContain("kill-session");
  });
});
