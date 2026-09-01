const RECOVERABLE_PERSISTENT_SESSION_ERRORS = new Set([
  "PERSISTENT_SESSION_READ_ONLY",
]);

export function isRecoverablePersistentSessionError(code: unknown): boolean {
  return (
    typeof code === "string" && RECOVERABLE_PERSISTENT_SESSION_ERRORS.has(code)
  );
}
