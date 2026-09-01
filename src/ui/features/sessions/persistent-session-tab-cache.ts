export type CachedPersistentSessionTab = {
  sessionId: string;
  hostId: number;
  label: string;
  clientId: string;
  role: "writer" | "viewer";
  takeover: boolean;
  instanceId: string;
};

const STORAGE_KEY = "termix-persistent-session-tabs-v1";

export function readPersistentSessionTabCache(): CachedPersistentSessionTab[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is CachedPersistentSessionTab =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as CachedPersistentSessionTab).sessionId === "string" &&
        typeof (entry as CachedPersistentSessionTab).hostId === "number" &&
        typeof (entry as CachedPersistentSessionTab).label === "string" &&
        typeof (entry as CachedPersistentSessionTab).clientId === "string" &&
        ((entry as CachedPersistentSessionTab).role === "writer" ||
          (entry as CachedPersistentSessionTab).role === "viewer") &&
        typeof (entry as CachedPersistentSessionTab).takeover === "boolean" &&
        typeof (entry as CachedPersistentSessionTab).instanceId === "string",
    );
  } catch {
    return [];
  }
}

export function writePersistentSessionTabCache(
  tabs: CachedPersistentSessionTab[],
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
}
