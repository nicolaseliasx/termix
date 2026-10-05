import { describe, expect, it, vi } from "vitest";
import { PersistentSessionLifecycleService } from "../../../hosts/sessions/lifecycle.js";
import { PersistentSessionError } from "../../../hosts/sessions/errors.js";
import type { PersistentSessionRecord } from "../../../database/repositories/persistent-session-repository.js";

function record(): PersistentSessionRecord {
  return {
    id: "session-id",
    userId: "u",
    hostId: 7,
    displayName: "codex",
    tmuxSessionName: "codex",
    managementState: "managed",
    expiryMode: "manual",
    expirySeconds: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    remoteCreatedAt: null,
    lastAttachedAt: null,
    lastDetachedAt: null,
    expiresAt: null,
    lastObservedAt: null,
    hibernatedAt: null,
    endedAt: null,
    endReason: null,
  } as PersistentSessionRecord;
}

function fixtures(
  remote: unknown[] = [],
  overrides: { ended?: PersistentSessionRecord } = {},
) {
  const saved = overrides.ended ?? record();
  const repository = {
    findByIdForUser: vi.fn(async () => saved),
    findActiveByHostAndTmux: vi.fn(async () => saved),
    markEnded: vi.fn(async (_id: string, _userId: string, reason: string) => ({
      ...saved,
      endedAt: "2026-09-22T00:00:00.000Z",
      endReason: reason,
    })),
  };
  const gateway = {
    list: vi.fn(async () => remote),
    kill: vi.fn(async () => undefined),
    killUnguarded: vi.fn(async () => undefined),
  };
  const service = new PersistentSessionLifecycleService(
    repository as never,
    gateway as never,
    async () => ({ id: 7 }) as never,
  );
  return { repository, gateway, service, saved };
}

describe("PersistentSessionLifecycleService kill", () => {
  it("ends the local record with force when the host is unreachable", async () => {
    const { repository, gateway, service } = fixtures();
    gateway.list.mockRejectedValue(
      new PersistentSessionError("PERSISTENT_SESSION_REMOTE_UNAVAILABLE"),
    );

    await expect(
      service.kill("session-id", "u", { force: true }),
    ).resolves.toMatchObject({ endedAt: "2026-09-22T00:00:00.000Z" });
    expect(repository.markEnded).toHaveBeenCalledWith(
      "session-id",
      "u",
      "killed-unreachable",
    );
  });

  it("still fails without force when the host is unreachable", async () => {
    const { gateway, service } = fixtures();
    gateway.list.mockRejectedValue(
      new PersistentSessionError("PERSISTENT_SESSION_REMOTE_UNAVAILABLE"),
    );
    await expect(service.kill("session-id", "u")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
    });
  });

  it("never remotely kills a mismatched marker, even with force", async () => {
    const { repository, gateway, service } = fixtures([
      { name: "codex", marker: { id: "someone-else" } },
    ]);

    await service.kill("session-id", "u", { force: true });

    expect(gateway.kill).not.toHaveBeenCalled();
    expect(gateway.killUnguarded).not.toHaveBeenCalled();
    expect(repository.markEnded).toHaveBeenCalledWith(
      "session-id",
      "u",
      "killed-unreachable",
    );
  });

  it("terminates an unmarked remote session owned by the local record", async () => {
    const { repository, gateway, service } = fixtures();
    gateway.list
      .mockResolvedValueOnce([{ name: "codex" }])
      .mockResolvedValueOnce([]);

    await service.kill("session-id", "u");

    expect(gateway.killUnguarded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      "codex",
    );
    expect(repository.markEnded).toHaveBeenCalledWith(
      "session-id",
      "u",
      "killed",
    );
  });

  it("does not kill an unmarked session owned by another active record", async () => {
    const { repository, gateway, service } = fixtures([{ name: "codex" }]);
    repository.findActiveByHostAndTmux.mockResolvedValue({
      ...record(),
      id: "someone-else",
    });

    await expect(service.kill("session-id", "u")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_MARKER_MISMATCH",
    });
    expect(gateway.killUnguarded).not.toHaveBeenCalled();
    expect(repository.markEnded).not.toHaveBeenCalled();
  });

  it("keeps the local record when an unmarked remote session survives kill", async () => {
    const { repository, gateway, service } = fixtures([{ name: "codex" }]);

    await expect(service.kill("session-id", "u")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_REMOTE_FAILED",
    });
    expect(repository.markEnded).not.toHaveBeenCalled();
    expect(gateway.list).toHaveBeenCalledTimes(2);
  });

  it("kills an unmarked remote session by name on force", async () => {
    const { repository, gateway, service } = fixtures();
    gateway.list
      .mockResolvedValueOnce([{ name: "codex" }])
      .mockResolvedValueOnce([]);

    await service.kill("session-id", "u", { force: true });

    expect(gateway.killUnguarded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      "codex",
    );
    expect(gateway.kill).not.toHaveBeenCalled();
    expect(repository.markEnded).toHaveBeenCalledWith(
      "session-id",
      "u",
      "killed",
    );
  });

  it("fails without force on a marker mismatch", async () => {
    const { service } = fixtures([
      { name: "codex", marker: { id: "someone-else" } },
    ]);
    await expect(service.kill("session-id", "u")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_MARKER_MISMATCH",
    });
  });

  it("kills remotely and records a plain kill when markers match", async () => {
    const { repository, gateway, service } = fixtures();
    gateway.list
      .mockResolvedValueOnce([{ name: "codex", marker: { id: "session-id" } }])
      .mockResolvedValueOnce([]);

    await service.kill("session-id", "u");

    expect(gateway.kill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      "codex",
      "session-id",
    );
    expect(repository.markEnded).toHaveBeenCalledWith(
      "session-id",
      "u",
      "killed",
    );
  });
});
