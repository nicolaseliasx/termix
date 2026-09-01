import { describe, expect, it } from "vitest";
import { isRecoverablePersistentSessionError } from "@/features/terminal/terminal-persistent-session";

describe("isRecoverablePersistentSessionError", () => {
  it("keeps the socket open for input attempted during read-only takeover", () => {
    expect(
      isRecoverablePersistentSessionError("PERSISTENT_SESSION_READ_ONLY"),
    ).toBe(true);
  });

  it("keeps attachment and transport failures terminal", () => {
    expect(
      isRecoverablePersistentSessionError("PERSISTENT_SESSION_CONNECT_FAILED"),
    ).toBe(false);
    expect(
      isRecoverablePersistentSessionError("PERSISTENT_SESSION_WRITER_CONFLICT"),
    ).toBe(false);
  });
});
