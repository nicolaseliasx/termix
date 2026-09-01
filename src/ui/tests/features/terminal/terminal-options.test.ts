import { describe, expect, it } from "vitest";
import { getTerminalOverviewRulerOptions } from "@/features/terminal/terminal-options";

describe("getTerminalOverviewRulerOptions", () => {
  it("uses a one-pixel overview ruler on mobile", () => {
    expect(getTerminalOverviewRulerOptions(true)).toEqual({ width: 1 });
  });

  it("uses xterm's default overview ruler options on desktop", () => {
    expect(getTerminalOverviewRulerOptions(false)).toEqual({});
  });
});
