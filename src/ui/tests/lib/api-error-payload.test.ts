import { describe, expect, it } from "vitest";
import { normalizeApiErrorPayload } from "@/lib/api-error-payload";

describe("normalizeApiErrorPayload", () => {
  it("normalizes legacy error responses", () => {
    expect(
      normalizeApiErrorPayload({ error: "Database unavailable", code: "DB" }),
    ).toEqual({ message: "Database unavailable", code: "DB" });
  });

  it("normalizes typed nested error responses", () => {
    expect(
      normalizeApiErrorPayload({
        error: {
          code: "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
          message: "Remote host is unavailable",
        },
      }),
    ).toEqual({
      message: "Remote host is unavailable",
      code: "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
    });
  });

  it("does not leak object values into string-only consumers", () => {
    expect(normalizeApiErrorPayload({ error: { details: true } })).toEqual({
      message: undefined,
      code: undefined,
    });
  });
});
