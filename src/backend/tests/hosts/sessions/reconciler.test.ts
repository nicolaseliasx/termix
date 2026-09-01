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
      recordEvent: vi.fn(),
      create: vi.fn(),
    },
    gateway: {
      list,
      mark: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      kill: vi.fn(),
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
});
