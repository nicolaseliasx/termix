import { describe, expect, it } from "vitest";
import { getMobileVisualViewportCssValues } from "@/shell/mobile-visual-viewport";

describe("getMobileVisualViewportCssValues", () => {
  it("uses the visible viewport height exposed while the iOS keyboard is open", () => {
    expect(
      getMobileVisualViewportCssValues({
        height: 512.4,
        offsetTop: 37.6,
      }),
    ).toEqual({
      height: "550px",
    });
  });

  it("clamps transient invalid dimensions during Safari viewport animation", () => {
    expect(
      getMobileVisualViewportCssValues({
        height: 0,
        offsetTop: -12,
      }),
    ).toEqual({
      height: "1px",
    });
  });
});
