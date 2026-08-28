export type NormalizedApiErrorPayload = {
  message?: string;
  code?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize both legacy `{ error: string }` and typed error envelopes. */
export function normalizeApiErrorPayload(
  value: unknown,
): NormalizedApiErrorPayload {
  if (typeof value === "string") return { message: value };
  if (!isRecord(value)) return {};

  const nestedError = isRecord(value.error) ? value.error : undefined;
  const message =
    (typeof value.message === "string" ? value.message : undefined) ??
    (typeof value.error === "string" ? value.error : undefined) ??
    (typeof nestedError?.message === "string"
      ? nestedError.message
      : undefined);
  const code =
    (typeof value.code === "string" ? value.code : undefined) ??
    (typeof nestedError?.code === "string" ? nestedError.code : undefined);

  return { message, code };
}
