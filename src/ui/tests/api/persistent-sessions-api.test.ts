import { beforeEach, describe, expect, it, vi } from "vitest";

const authApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/main-axios", () => ({
  authApi: authApiMock,
  handleApiError: (error: unknown) => error,
}));

import {
  createPersistentSession,
  listPersistentSessions,
  reconcilePersistentSessions,
} from "../../api/persistent-sessions-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistent sessions API", () => {
  it("uses the versioned route and maps list metadata", async () => {
    authApiMock.get.mockResolvedValueOnce({
      data: {
        data: [{ id: "session-1" }],
        meta: { total: 1, limit: 50, offset: 0 },
      },
    });

    await expect(listPersistentSessions()).resolves.toEqual({
      data: [{ id: "session-1" }],
      total: 1,
    });
    expect(authApiMock.get).toHaveBeenCalledWith(
      "/api/v1/persistent-sessions",
      { signal: undefined },
    );
  });

  it("rejects an HTML fallback without inspecting it as an envelope", async () => {
    authApiMock.get.mockResolvedValueOnce({ data: "<!doctype html>" });

    await expect(listPersistentSessions()).rejects.toThrow(
      "Invalid response from the persistent sessions API",
    );
  });

  it("uses the versioned route when creating a session", async () => {
    authApiMock.post.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
    });
    const input = {
      hostId: 1,
      displayName: "dev",
      tmuxSessionName: "dev",
    };

    await expect(createPersistentSession(input)).resolves.toEqual({
      id: "session-1",
    });
    expect(authApiMock.post).toHaveBeenCalledWith(
      "/api/v1/persistent-sessions",
      input,
    );
  });

  it("parses per-host reconciliation status from the versioned route", async () => {
    authApiMock.post.mockResolvedValueOnce({
      data: {
        data: {
          hosts: [
            {
              hostId: 7,
              status: "offline",
              observed: 0,
              adopted: 0,
              missing: 0,
            },
          ],
        },
      },
    });

    await expect(reconcilePersistentSessions()).resolves.toEqual([
      { hostId: 7, status: "offline", observed: 0, adopted: 0, missing: 0 },
    ]);
    expect(authApiMock.post).toHaveBeenCalledWith(
      "/api/v1/persistent-session-reconciliations",
      undefined,
      { signal: undefined },
    );
  });
});
