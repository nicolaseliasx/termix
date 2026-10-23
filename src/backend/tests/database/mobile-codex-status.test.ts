import { describe, expect, it } from "vitest";
import { parseCodexStatus } from "../../database/routes/mobile-codex-status.js";

const profile = {
  state: "available",
  remainingPercent: 67,
  windows: [
    { name: "primary", remainingPercent: 67, resetsAt: 123, token: "secret" },
  ],
  activeSessions: ["work"],
  email: "private@example.com",
};

describe("mobile Codex status", () => {
  it("returns only approved status fields", () => {
    const result = parseCodexStatus(
      JSON.stringify({
        checkedAt: "2026-10-23T18:00:00Z",
        profiles: { codex: profile, codex2: profile },
        credential: "secret",
      }),
    );
    expect(result).toEqual({
      checkedAt: "2026-10-23T18:00:00Z",
      profiles: {
        codex: {
          state: "available",
          remainingPercent: 67,
          windows: [{ name: "primary", remainingPercent: 67, resetsAt: 123 }],
          activeSessions: ["work"],
        },
        codex2: {
          state: "available",
          remainingPercent: 67,
          windows: [{ name: "primary", remainingPercent: 67, resetsAt: 123 }],
          activeSessions: ["work"],
        },
      },
    });
  });

  it("rejects malformed profiles", () => {
    expect(() =>
      parseCodexStatus(
        JSON.stringify({
          checkedAt: "2026-10-23T18:00:00Z",
          profiles: {
            codex: { ...profile, remainingPercent: 101 },
            codex2: profile,
          },
        }),
      ),
    ).toThrow("Invalid Codex status response");
  });
});
