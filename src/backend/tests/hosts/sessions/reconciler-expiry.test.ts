import { describe, expect, it } from "vitest";
import { PersistentSessionExpirer } from "../../../hosts/sessions/expiry.js";
import { PersistentSessionReconciler } from "../../../hosts/sessions/reconciler.js";

const now = new Date("2026-08-26T12:00:00.000Z");
const row = {
  id: "marker",
  userId: "owner",
  hostId: 7,
  displayName: "work",
  tmuxSessionName: "work",
  expiryMode: "idle",
  expirySeconds: 300,
  expiresAt: "2026-08-26T11:59:00.000Z",
  endedAt: null,
};

describe("persistent-session maintenance", () => {
  it("recovers marked tmux sessions and auto-adopts unmarked sessions", async () => {
    const created: unknown[] = [];
    const repository = {
      listActiveByHostForUser: async () => [],
      findActiveByHostAndTmux: async () => null,
      create: async (input: unknown) => {
        created.push(input);
        return input as { id: string };
      },
      update: async () => null,
    };
    let externalMarkerId: string | undefined;
    const gateway = {
      list: async () => [
        {
          name: "managed",
          attachedClients: 0,
          marker: {
            id: "remote-id",
            createdAt: now.toISOString(),
            expiryMode: "manual" as const,
          },
        },
        externalMarkerId
          ? {
              name: "external",
              attachedClients: 0,
              marker: {
                id: externalMarkerId,
                createdAt: now.toISOString(),
                expiryMode: "manual" as const,
              },
            }
          : { name: "external", attachedClients: 0 },
      ],
      mark: async (_host: unknown, input: { id: string }) => {
        externalMarkerId = input.id;
      },
    };
    const reconciler = new PersistentSessionReconciler(
      repository as never,
      gateway as never,
      async () => [{ id: 7, userId: "owner" }],
      async () => ({ id: 7 }) as never,
      () => now,
    );
    await expect(reconciler.runOnce()).resolves.toMatchObject({
      recovered: 1,
      discovered: 1,
      missing: 0,
      results: [{ status: "online", observed: 2, adopted: 1 }],
    });
    expect(created).toHaveLength(2);
    expect((created[0] as { id: string }).id).toBe("remote-id");
  });

  it("does not mark a session missing while its host is unavailable", async () => {
    let ended = false;
    const repository = {
      listActiveByHostForUser: async () => [row],
      markEnded: async () => {
        ended = true;
      },
      findActiveByHostAndTmux: async () => null,
    };
    const reconciler = new PersistentSessionReconciler(
      repository as never,
      {
        list: async () => {
          throw new Error("offline");
        },
      } as never,
      async () => [{ id: 7, userId: "owner" }],
      async () => ({ id: 7 }) as never,
      () => now,
    );
    await expect(reconciler.runOnce()).resolves.toMatchObject({
      offline: 1,
      missing: 0,
    });
    expect(ended).toBe(false);
  });

  it("starts the first reconciliation without waiting for the recurring interval", async () => {
    let listed = 0;
    const repository = {
      listActiveByHostForUser: async () => [],
      findActiveByHostAndTmux: async () => null,
    };
    const reconciler = new PersistentSessionReconciler(
      repository as never,
      {
        list: async () => {
          listed++;
          return [];
        },
      } as never,
      async () => [{ id: 7, userId: "owner" }],
      async () => ({ id: 7 }) as never,
      () => now,
    );
    reconciler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    reconciler.stop();
    expect(listed).toBe(1);
  });

  it("postpones expiry while a tmux client is attached and never kills it", async () => {
    let killed = false;
    const updates: unknown[] = [];
    const repository = {
      listDueExpiry: async () => [row],
      findByIdForUser: async () => row,
      update: async (...input: unknown[]) => {
        updates.push(input);
        return row;
      },
      recordEvent: async () => {},
      pruneEndedOlderThan: async () => {},
      markEnded: async () => row,
    };
    const expirer = new PersistentSessionExpirer(
      repository as never,
      {
        list: async () => [
          { name: "work", attachedClients: 1, marker: { id: "marker" } },
        ],
        kill: async () => {
          killed = true;
        },
      } as never,
      async () => ({ id: 7 }) as never,
      () => now,
    );
    await expect(expirer.runOnce()).resolves.toMatchObject({
      postponed: 1,
      expired: 0,
    });
    expect(killed).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it("kills only a verified, detached marker session", async () => {
    let killed = false;
    let ended = false;
    let listed = 0;
    const repository = {
      listDueExpiry: async () => [row],
      findByIdForUser: async () => row,
      update: async () => row,
      recordEvent: async () => {},
      pruneEndedOlderThan: async () => {},
      markEnded: async () => {
        ended = true;
        return row;
      },
    };
    const gateway = {
      list: async () =>
        listed++ === 0
          ? [{ name: "work", attachedClients: 0, marker: { id: "marker" } }]
          : [],
      kill: async () => {
        killed = true;
      },
    };
    const expirer = new PersistentSessionExpirer(
      repository as never,
      gateway as never,
      async () => ({ id: 7 }) as never,
      () => now,
    );
    await expect(expirer.runOnce()).resolves.toMatchObject({ expired: 1 });
    expect(killed).toBe(true);
    expect(ended).toBe(true);
  });
});
