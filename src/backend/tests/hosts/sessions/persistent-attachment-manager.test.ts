import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  PersistentAttachmentManager,
  PersistentAttachmentError,
} from "../../../hosts/sessions/persistent-attachment-manager.js";

class FakeStream extends EventEmitter {
  readonly writes: string[] = [];
  readonly stderr = new EventEmitter();
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
  readonly shellOptions: unknown[] = [];
  ended = false;

  constructor(
    private readonly shellFails = false,
    private readonly emitInitialData = true,
  ) {
    super();
  }

  shell(
    options: unknown,
    callback: (error?: Error, stream?: FakeStream) => void,
  ) {
    this.shellOptions.push(options);
    if (this.shellFails) {
      callback(new Error("Unable to create terminal"));
      return;
    }
    callback(undefined, this.stream);
    if (this.emitInitialData) {
      setTimeout(() => this.stream.emit("data", Buffer.from("screen")), 0);
    }
  }
  end() {
    this.ended = true;
    this.emit("close");
  }
}

function setup(preflightExitCode = 0, emitInitialData = true) {
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
      const client = new FakeClient(preflightExitCode, emitInitialData);
      clients.push(client);
      return client as never;
    },
  } as never);
  const socket = () => ({
    readyState: 1,
    messages: [] as string[],
    closeCalls: [] as Array<[number | undefined, string | undefined]>,
    send(data: string) {
      this.messages.push(data);
    },
    close(code?: number, reason?: string) {
      this.closeCalls.push([code, reason]);
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
    expect(
      clients[1].stream.writes.some((command) =>
        ["tmux -u attach-session -r -t", "termix-persist"].every((part) =>
          command.includes(part),
        ),
      ),
    ).toBe(true);
    expect(clients[1].shellOptions).toContainEqual({
      term: "xterm-256color",
      cols: 90,
      rows: 30,
    });
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
        client.stream.writes.some((command) =>
          ["attach-session -r -t", "termix-persist"].every((part) =>
            command.includes(part),
          ),
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

  it("closes failed SSH transports instead of leaking connections", async () => {
    const { manager, clients, socket } = setup(1);
    await expect(
      manager.attach({
        persistentSessionId: "session",
        userId: "owner",
        socket: socket(),
        clientId: "writer",
        role: "writer",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_CONNECT_FAILED",
    } satisfies Partial<PersistentAttachmentError>);
    expect(clients[0].ended).toBe(true);
  });

  it("reports an unexpected remote tmux close and closes the websocket", async () => {
    const { manager, clients, socket } = setup();
    const attachedSocket = socket();
    await manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: attachedSocket,
      clientId: "writer",
      role: "writer",
      cols: 80,
      rows: 24,
    });
    clients[0].stream.emit("close", 1);
    expect(attachedSocket.messages).toContain(
      JSON.stringify({
        type: "persistent_error",
        code: "PERSISTENT_SESSION_REMOTE_CLOSED",
        message: "The remote tmux session closed unexpectedly",
      }),
    );
    expect(attachedSocket.closeCalls).toEqual([
      [1011, "Remote tmux session closed"],
    ]);
  });

  it("does not report attached when tmux closes before its first frame", async () => {
    const { manager, clients, socket } = setup(0, false);
    const attaching = manager.attach({
      persistentSessionId: "session",
      userId: "owner",
      socket: socket(),
      clientId: "writer",
      role: "writer",
      cols: 80,
      rows: 24,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    clients[0].stream.emit("close", 1);
    await expect(attaching).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_START_FAILED",
    } satisfies Partial<PersistentAttachmentError>);
    expect(clients[0].ended).toBe(true);
  });
});
