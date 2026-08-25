import { describe, expect, it } from "vitest";
import { resolveTermixFeatures } from "../src/shared/features";

describe("resolveTermixFeatures", () => {
  it("uses the lean core profile by default", () => {
    expect(resolveTermixFeatures({}).flags).toMatchObject({
      FEATURE_SFTP: false,
      FEATURE_DOCKER: false,
      FEATURE_AUTOMATIONS_PANEL: false,
    });
  });

  it("enables every retained optional feature in full", () => {
    expect(
      Object.values(
        resolveTermixFeatures({ TERMIX_BUILD_PROFILE: "full" }).flags,
      ),
    ).toEqual(Array(9).fill(true));
  });

  it("applies explicit custom overrides", () => {
    const result = resolveTermixFeatures({
      TERMIX_BUILD_PROFILE: "custom",
      FEATURE_SFTP: "true",
      FEATURE_HISTORY: "false",
    });
    expect(result.flags.FEATURE_SFTP).toBe(true);
    expect(result.flags.FEATURE_HISTORY).toBe(false);
  });

  it.each([
    { TERMIX_BUILD_PROFILE: "invalid" },
    { TERMIX_BUILD_PROFILE: "core", FEATURE_SFTP: "true" },
    { TERMIX_BUILD_PROFILE: "custom", FEATURE_SFTP: "yes" },
  ])("rejects invalid configuration %#", (environment) => {
    expect(() => resolveTermixFeatures(environment)).toThrow();
  });
});
