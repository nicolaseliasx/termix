export type PersistentSessionErrorCode =
  | "PERSISTENT_SESSION_INVALID_REQUEST"
  | "PERSISTENT_SESSION_INVALID_NAME"
  | "PERSISTENT_SESSION_INVALID_DIRECTORY"
  | "PERSISTENT_SESSION_INVALID_EXPIRY"
  | "PERSISTENT_SESSION_NOT_FOUND"
  | "PERSISTENT_SESSION_CONFLICT"
  | "PERSISTENT_SESSION_MARKER_MISMATCH"
  | "PERSISTENT_SESSION_REMOTE_UNAVAILABLE"
  | "PERSISTENT_SESSION_REMOTE_FAILED";

const statusByCode: Record<PersistentSessionErrorCode, number> = {
  PERSISTENT_SESSION_INVALID_REQUEST: 400,
  PERSISTENT_SESSION_INVALID_NAME: 422,
  PERSISTENT_SESSION_INVALID_DIRECTORY: 422,
  PERSISTENT_SESSION_INVALID_EXPIRY: 422,
  PERSISTENT_SESSION_NOT_FOUND: 404,
  PERSISTENT_SESSION_CONFLICT: 409,
  PERSISTENT_SESSION_MARKER_MISMATCH: 409,
  PERSISTENT_SESSION_REMOTE_UNAVAILABLE: 503,
  PERSISTENT_SESSION_REMOTE_FAILED: 503,
};
const messageByCode: Record<PersistentSessionErrorCode, string> = {
  PERSISTENT_SESSION_INVALID_REQUEST: "Invalid persistent session request",
  PERSISTENT_SESSION_INVALID_NAME: "Invalid persistent session name",
  PERSISTENT_SESSION_INVALID_DIRECTORY: "Invalid working directory",
  PERSISTENT_SESSION_INVALID_EXPIRY: "Invalid expiry policy",
  PERSISTENT_SESSION_NOT_FOUND: "Persistent session not found",
  PERSISTENT_SESSION_CONFLICT:
    "Persistent session conflicts with an active session",
  PERSISTENT_SESSION_MARKER_MISMATCH: "Remote session marker does not match",
  PERSISTENT_SESSION_REMOTE_UNAVAILABLE: "Remote host is unavailable",
  PERSISTENT_SESSION_REMOTE_FAILED:
    "Remote persistent session operation failed",
};
export class PersistentSessionError extends Error {
  readonly status: number;
  constructor(
    readonly code: PersistentSessionErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(messageByCode[code]);
    this.name = "PersistentSessionError";
    this.status = statusByCode[code];
  }
}
export function asPersistentSessionError(
  error: unknown,
): PersistentSessionError {
  if (error instanceof PersistentSessionError) return error;
  const code = error instanceof Error ? error.message : "";
  if (code === "PERSISTENT_SESSION_CONFLICT")
    return new PersistentSessionError("PERSISTENT_SESSION_CONFLICT");
  if (code === "PERSISTENT_SESSION_INVALID_NAME")
    return new PersistentSessionError("PERSISTENT_SESSION_INVALID_NAME");
  if (code === "PERSISTENT_SESSION_INVALID_DIRECTORY")
    return new PersistentSessionError("PERSISTENT_SESSION_INVALID_DIRECTORY");
  return new PersistentSessionError("PERSISTENT_SESSION_REMOTE_FAILED");
}
