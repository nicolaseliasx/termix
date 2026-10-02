import { describe, expect, it, vi } from "vitest";
import { PersistentSessionReconciler } from "../../../hosts/sessions/reconciler.js";

function dependencies(list: () => Promise<unknown[]>) {
  return {
    repository: {
      pruneEndedOlderThan: vi.fn(async () => undefined),
      listActiveByHostForUser: vi.fn(async () => []),
      findActiveByHostAndTmux: vi.fn(async () => null),
      markEnded: vi.fn(),
      update: vi.fn(),
      touchLastObserved: vi.fn(),
      setHibernatedAt: vi.fn(),
      recordEvent: vi.fn(),
      create: vi.fn(),
    },
    gateway: {
      list,
      mark: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      kill: vi.fn(),
      freeze: vi.fn(),
      thaw: vi.fn(),
    },
  };
}

describe("PersistentSessionReconciler", () => {
  it("deduplicates concurrent requests for the same user and host", async () => {
    let release!: () => void;
    const list = vi.fn(
      () => new Promise<unknown[]>((resolve) => (release = () => resolve([]))),
    );
    const deps = dependencies(list);
    const reconciler = new PersistentSessionReconciler(
      deps.repository as never,
      deps.gateway as never,
      async () => [],
      async () => ({ id: 7 }) as never,
    );
    const first = reconciler.reconcileHosts([{ id: 7, userId: "u" }]);
    const second = reconciler.reconcileHosts([{ id: 7, userId: "u" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("freezes an unattached session idle longer than the configured limit", async () => {
    const deps = dependencies(async () => [
      {
        name: "idle-session",
        activityAt: "1000",
        attachedClients: 0,
        marker: { id: "session-id" },
      },
    ]);
    deps.repository.listActiveByHostForUser.mockResolvedValue([
      { id: "session-id", tmuxSessionName: "idle-session", hibernatedAt: null },
    ]);
    const reconciler = new PersistentSessionReconciler(
      deps.repository as never,
      deps.gateway as never,
      async () => [],
      async () => ({ id: 7 }) as never,
      () => new Date("2026-09-22T12:00:00.000Z"),
      {
        reachability: async () => true,
        hibernateIdleHours: async () => 6,
        attachedClients: () => 0,
      },
    );

    const result = await reconciler.reconcileHosts([{ id: 7, userId: "u" }]);

    expect(deps.gateway.freeze).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      "idle-session",
    );
    expect(deps.repository.setHibernatedAt).toHaveBeenCalledWith(
      "session-id",
      "u",
      "2026-09-22T12:00:00.000Z",
    );
    expect(result.results[0]?.hibernated).toBe(1);
  });

  it("never freezes a session with an active Termix client", async () => {
    const deps = dependencies(async () => [
      {
        name: "active-session",
        activityAt: "1000",
        attachedClients: 0,
        marker: { id: "session-id" },
      },
    ]);
    deps.repository.listActiveByHostForUser.mockResolvedValue([
      {
        id: "session-id",
        tmuxSessionName: "active-session",
        hibernatedAt: null,
      },
    ]);
    const reconciler = new PersistentSessionReconciler(
      deps.repository as never,
      deps.gateway as never,
      async () => [],
      async () => ({ id: 7 }) as never,
      () => new Date("2026-09-22T12:00:00.000Z"),
      {
        reachability: async () => true,
        hibernateIdleHours: async () => 6,
        attachedClients: () => 1,
      },
    );

    await reconciler.reconcileHosts([{ id: 7, userId: "u" }]);
    expect(deps.gateway.freeze).not.toHaveBeenCalled();
  });

  it("re-asserts the freeze on a still-idle hibernated session", async () => {
    // A pass between attach and detach can miss the client entirely; the
    // inline CONT at attach thaws the panes, so the freeze must be healed
    // instead of trusting the stale hibernatedAt flag.
    const deps = dependencies(async () => [
      {
        name: "idle-session",
        activityAt: "1000",
        attachedClients: 0,
        marker: { id: "session-id" },
      },
    ]);
    deps.repository.listActiveByHostForUser.mockResolvedValue([
      {
        id: "session-id",
        tmuxSessionName: "idle-session",
        hibernatedAt: "2026-09-22T02:00:00.000Z",
      },
    ]);
    const reconciler = new PersistentSessionReconciler(
      deps.repository as never,
      deps.gateway as never,
      async () => [],
      async () => ({ id: 7 }) as never,
      () => new Date("2026-09-22T12:00:00.000Z"),
      {
        reachability: async () => true,
        hibernateIdleHours: async () => 6,
        attachedClients: () => 0,
      },
    );

    await reconciler.reconcileHosts([{ id: 7, userId: "u" }]);

    expect(deps.gateway.freeze).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      "idle-session",
    );
    expect(deps.repository.setHibernatedAt).not.toHaveBeenCalled();
  });

  it("clears a stale hibernation flag when the session was used recently", async () => {
    const deps = dependencies(async () => [
      {
        name: "woken-session",
        // 30 minutes before the frozen `now`: an attach woke the panes.
        activityAt: String(
          new Date("2026-09-22T11:30:00.000Z").getTime() / 1000,
        ),
        attachedClients: 0,
        marker: { id: "session-id" },
      },
    ]);
    deps.repository.listActiveByHostForUser.mockResolvedValue([
      {
        id: "session-id",
        tmuxSessionName: "woken-session",
        hibernatedAt: "2026-09-20T02:00:00.000Z",
      },
    ]);
    const reconciler = new PersistentSessionReconciler(
      deps.repository as never,
      deps.gateway as never,
      async () => [],
      async () => ({ id: 7 }) as never,
      () => new Date("2026-09-22T12:00:00.000Z"),
      {
        reachability: async () => true,
        hibernateIdleHours: async () => 6,
        attachedClients: () => 0,
      },
    );

    await reconciler.reconcileHosts([{ id: 7, userId: "u" }]);

    expect(deps.gateway.freeze).not.toHaveBeenCalled();
    expect(deps.repository.setHibernatedAt).toHaveBeenCalledWith(
      "session-id",
      "u",
      null,
    );
  });
});
