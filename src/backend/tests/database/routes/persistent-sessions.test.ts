import { describe, expect, it } from "vitest";
import router from "../../../database/routes/persistent-sessions.js";

describe("persistent session routes", () => {
  it("mounts the owner-scoped lifecycle resources", () => {
    const paths = router.stack
      .map((layer: { route?: { path: string } }) => layer.route?.path)
      .filter(Boolean);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/persistent-sessions",
        "/persistent-sessions/:id",
        "/persistent-session-adoptions",
        "/persistent-session-reconciliations",
        "/hosts/:hostId/persistent-session-reconciliations",
      ]),
    );
  });
});
