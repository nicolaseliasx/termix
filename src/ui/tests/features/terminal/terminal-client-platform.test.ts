import { describe, expect, it } from "vitest";
import { isIOSWebKitClient } from "@/features/terminal/terminal-client-platform";

describe("isIOSWebKitClient", () => {
  it("detects iPhone Safari", () => {
    expect(
      isIOSWebKitClient({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("detects iPadOS when it identifies itself as macOS", () => {
    expect(
      isIOSWebKitClient({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("does not classify desktop Safari as iOS", () => {
    expect(
      isIOSWebKitClient({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
