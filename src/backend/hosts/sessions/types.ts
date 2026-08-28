export type PersistentSessionRole = "writer" | "viewer";
export type PersistentSessionManagementState = "managed" | "discovered";
export type PersistentSessionExpiryMode = "manual" | "idle";

export interface PersistentSessionMarker {
  id: string;
  createdAt: string;
  expiryMode: PersistentSessionExpiryMode;
  expirySeconds?: number;
}

export interface RemotePersistentSession {
  name: string;
  createdAt?: string;
  activityAt?: string;
  attachedClients: number;
  marker?: PersistentSessionMarker;
}

export const PERSISTENT_SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MIN_IDLE_EXPIRY_SECONDS = 5 * 60;
export const MAX_IDLE_EXPIRY_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_IDLE_EXPIRY_SECONDS = 6 * 60 * 60;

export function validatePersistentSessionName(name: unknown): name is string {
  return typeof name === "string" && PERSISTENT_SESSION_NAME.test(name);
}

export function validateIdleExpiry(seconds: unknown): seconds is number {
  return (
    typeof seconds === "number" &&
    Number.isInteger(seconds) &&
    seconds >= MIN_IDLE_EXPIRY_SECONDS &&
    seconds <= MAX_IDLE_EXPIRY_SECONDS
  );
}
