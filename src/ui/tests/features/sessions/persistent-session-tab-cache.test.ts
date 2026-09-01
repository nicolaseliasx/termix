import { beforeEach, describe, expect, it } from "vitest";
import {
  readPersistentSessionTabCache,
  writePersistentSessionTabCache,
} from "@/features/sessions/persistent-session-tab-cache";

describe("persistent session tab cache", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the persistent-session attachment data needed after a reload", () => {
    const tabs = [
      {
        sessionId: "session-1",
        hostId: 1,
        label: "codex",
        clientId: "client-1",
        role: "writer" as const,
        takeover: false,
        instanceId: "tab-1",
      },
    ];

    writePersistentSessionTabCache(tabs);

    expect(readPersistentSessionTabCache()).toEqual(tabs);
  });

  it("ignores a malformed cache instead of restoring invalid tabs", () => {
    localStorage.setItem("termix-persistent-session-tabs-v1", "not-json");

    expect(readPersistentSessionTabCache()).toEqual([]);
  });
});
