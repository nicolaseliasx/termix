import { describe, expect, it } from "vitest";
import { PersistentSessionLifecycleService } from "../../../hosts/sessions/lifecycle.js";
import { PersistentSessionError } from "../../../hosts/sessions/errors.js";
import { DEFAULT_IDLE_EXPIRY_SECONDS } from "../../../hosts/sessions/types.js";
import type { PersistentSessionGateway } from "../../../hosts/sessions/gateway.js";
import type { PersistentSessionRepository } from "../../../database/repositories/persistent-session-repository.js";

describe("PersistentSessionLifecycleService", () => {
  const host = { id: 1 } as never;
  const record = {
    id: "session",
    userId: "owner",
    hostId: 1,
    displayName: "Session",
    tmuxSessionName: "session",
    expiryMode: "manual",
    endedAt: null,
  } as never;
  it("does not kill a remote session whose marker diverges", async () => {
    let killed = false;
    const repository = {
      findByIdForUser: async () => record,
      markEnded: async () => record,
    } as unknown as PersistentSessionRepository;
    const gateway: PersistentSessionGateway = {
      list: async () => [
        {
          name: "session",
          attachedClients: 0,
          marker: { id: "different", createdAt: "now", expiryMode: "manual" },
        },
      ],
      create: async () => {},
      mark: async () => {},
      rename: async () => {},
      kill: async () => {
        killed = true;
      },
    };
    const service = new PersistentSessionLifecycleService(
      repository,
      gateway,
      async () => host,
    );
    await expect(service.kill("session", "owner")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_MARKER_MISMATCH",
    } satisfies Partial<PersistentSessionError>);
    expect(killed).toBe(false);
  });
  it("does not mark sessions missing when remote listing fails", async () => {
    let ended = false;
    const repository = {
      listActiveByHostForUser: async () => [record],
      markEnded: async () => {
        ended = true;
        return record;
      },
    } as unknown as PersistentSessionRepository;
    const gateway: PersistentSessionGateway = {
      list: async () => {
        throw new PersistentSessionError(
          "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
        );
      },
      create: async () => {},
      mark: async () => {},
      rename: async () => {},
      kill: async () => {},
    };
    const service = new PersistentSessionLifecycleService(
      repository,
      gateway,
      async () => host,
    );
    await expect(service.refresh(1, "owner")).rejects.toMatchObject({
      code: "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
    });
    expect(ended).toBe(false);
  });
  it("defaults a create without expiry input to idle six hours", async () => {
    const created: Array<Record<string, unknown>> = [];
    const gatewayCreates: Array<Record<string, unknown>> = [];
    let createdId = "";
    const repository = {
      findActiveByHostAndTmux: async () => null,
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return { ...input, expiresAt: null };
      },
      update: async (
        _id: string,
        _userId: string,
        patch: Record<string, unknown>,
      ) => ({ ...patch }),
    } as unknown as PersistentSessionRepository;
    const gateway = {
      create: async (
        _host: unknown,
        input: Record<string, unknown>,
      ): Promise<void> => {
        gatewayCreates.push(input);
        createdId = input.id as string;
      },
      list: async () => [
        {
          name: "session",
          attachedClients: 0,
          marker: { id: createdId, createdAt: "now", expiryMode: "idle" },
        },
      ],
      mark: async () => {},
      rename: async () => {},
      kill: async () => {},
    } as unknown as PersistentSessionGateway;
    const service = new PersistentSessionLifecycleService(
      repository,
      gateway,
      async () => host,
    );
    await service.create("owner", {
      hostId: 1,
      displayName: "Session",
      tmuxSessionName: "session",
    });
    expect(DEFAULT_IDLE_EXPIRY_SECONDS).toBe(6 * 60 * 60);
    expect(gatewayCreates[0]).toMatchObject({
      expiryMode: "idle",
      expirySeconds: DEFAULT_IDLE_EXPIRY_SECONDS,
    });
    expect(created[0]).toMatchObject({
      expiryMode: "idle",
      expirySeconds: DEFAULT_IDLE_EXPIRY_SECONDS,
    });
  });
});
