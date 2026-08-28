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

export function validatePersistentSessionName(name: unknown): name is string {
  return typeof name === "string" && PERSISTENT_SESSION_NAME.test(name);
}
