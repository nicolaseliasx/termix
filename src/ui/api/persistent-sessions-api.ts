import { authApi, handleApiError } from "@/main-axios";

export type PersistentSessionRole = "writer" | "viewer";
export type PersistentSession = {
  id: string;
  hostId: number;
  displayName: string;
  tmuxSessionName: string;
  managementState: "managed" | "discovered";
  expiryMode: "manual" | "idle";
  expirySeconds: number | null;
  createdAt: string;
  lastAttachedAt: string | null;
  lastDetachedAt: string | null;
  expiresAt: string | null;
  lastObservedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
};

type ApiEnvelope<T> = { data: T };
type ApiListEnvelope<T> = {
  data: T[];
  meta: { total: number; limit: number; offset: number };
};
export type PersistentSessionsPage = {
  data: PersistentSession[];
  total: number;
};
export type PersistentSessionHostStatus = {
  hostId: number;
  status: "online" | "offline";
  observed: number;
  adopted: number;
  missing: number;
};
const API_BASE = "/api/v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrap<T>(value: ApiEnvelope<T> | T): T {
  return isRecord(value) && "data" in value
    ? (value as ApiEnvelope<T>).data
    : (value as T);
}

export async function listPersistentSessions(
  signal?: AbortSignal,
): Promise<PersistentSessionsPage> {
  try {
    const response = await authApi.get<ApiListEnvelope<PersistentSession>>(
      `${API_BASE}/persistent-sessions`,
      { signal },
    );
    if (
      !isRecord(response.data) ||
      !Array.isArray(response.data.data) ||
      !isRecord(response.data.meta) ||
      typeof response.data.meta.total !== "number"
    ) {
      throw new Error("Invalid response from the persistent sessions API");
    }
    return { data: response.data.data, total: response.data.meta.total };
  } catch (error) {
    throw handleApiError(error, "fetch persistent sessions");
  }
}

export async function reconcilePersistentSessions(
  signal?: AbortSignal,
): Promise<PersistentSessionHostStatus[]> {
  try {
    const response = await authApi.post<
      ApiEnvelope<{ hosts: PersistentSessionHostStatus[] }>
    >(`${API_BASE}/persistent-session-reconciliations`, undefined, { signal });
    const data = unwrap(response.data);
    if (
      !isRecord(data) ||
      !Array.isArray(data.hosts) ||
      !data.hosts.every(
        (host) =>
          isRecord(host) &&
          typeof host.hostId === "number" &&
          (host.status === "online" || host.status === "offline") &&
          typeof host.observed === "number" &&
          typeof host.adopted === "number" &&
          typeof host.missing === "number",
      )
    ) {
      throw new Error(
        "Invalid response from the persistent session reconciliation API",
      );
    }
    return data.hosts as PersistentSessionHostStatus[];
  } catch (error) {
    throw handleApiError(error, "reconcile persistent sessions");
  }
}

export async function createPersistentSession(input: {
  hostId: number;
  displayName: string;
  tmuxSessionName: string;
}): Promise<PersistentSession> {
  try {
    return unwrap(
      (
        await authApi.post<ApiEnvelope<PersistentSession>>(
          `${API_BASE}/persistent-sessions`,
          input,
        )
      ).data,
    );
  } catch (error) {
    throw handleApiError(error, "create persistent session");
  }
}

export async function patchPersistentSession(
  id: string,
  input: Partial<{
    displayName: string;
    tmuxSessionName: string;
  }>,
): Promise<PersistentSession> {
  try {
    return unwrap(
      (
        await authApi.patch<ApiEnvelope<PersistentSession>>(
          `${API_BASE}/persistent-sessions/${id}`,
          input,
        )
      ).data,
    );
  } catch (error) {
    throw handleApiError(error, "update persistent session");
  }
}

export async function killPersistentSession(
  id: string,
): Promise<PersistentSession> {
  try {
    return unwrap(
      (
        await authApi.delete<ApiEnvelope<PersistentSession>>(
          `${API_BASE}/persistent-sessions/${id}`,
        )
      ).data,
    );
  } catch (error) {
    throw handleApiError(error, "terminate persistent session");
  }
}

export async function adoptPersistentSession(input: {
  hostId: number;
  tmuxSessionName: string;
  displayName?: string;
}): Promise<PersistentSession> {
  try {
    return unwrap(
      (
        await authApi.post<ApiEnvelope<PersistentSession>>(
          `${API_BASE}/persistent-session-adoptions`,
          input,
        )
      ).data,
    );
  } catch (error) {
    throw handleApiError(error, "adopt persistent session");
  }
}
