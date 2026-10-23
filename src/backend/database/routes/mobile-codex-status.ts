import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../hosts/host-resolver.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../../hosts/ssh-client-factory.js";
import { withConnection } from "../../hosts/ssh-connection-pool.js";
import { execCommand } from "../../hosts/tmux/helper.js";

const router = express.Router();
const auth = AuthManager.getInstance();
const authenticateJWT = auth.createAuthMiddleware();
const requireDataAccess = auth.createDataAccessMiddleware();
const requireAdmin = auth.createAdminMiddleware();
const COMMAND = "python3 /home/admin/ios-distribution/scripts/codex_status.py";
const CACHE_MS = 60_000;
const TIMEOUT_MS = 35_000;

type WindowStatus = {
  name: "primary" | "secondary";
  remainingPercent: number;
  resetsAt: number | null;
};
type ProfileStatus = {
  state: "available" | "limited" | "unknown";
  remainingPercent: number | null;
  windows: WindowStatus[];
  activeSessions: string[];
};
type CodexStatus = {
  checkedAt: string;
  profiles: { codex: ProfileStatus; codex2: ProfileStatus };
};
type CachedStatus = { value: CodexStatus; expiresAt: number };
const cache = new Map<number, CachedStatus>();
const pending = new Map<number, Promise<CodexStatus>>();

function isProfile(value: unknown): value is ProfileStatus {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    ["available", "limited", "unknown"].includes(String(profile.state)) &&
    (profile.remainingPercent === null ||
      (typeof profile.remainingPercent === "number" &&
        profile.remainingPercent >= 0 &&
        profile.remainingPercent <= 100)) &&
    Array.isArray(profile.windows) &&
    profile.windows.every(
      (window: unknown) =>
        !!window &&
        typeof window === "object" &&
        ["primary", "secondary"].includes(
          String((window as WindowStatus).name),
        ) &&
        typeof (window as WindowStatus).remainingPercent === "number" &&
        (window as WindowStatus).remainingPercent >= 0 &&
        (window as WindowStatus).remainingPercent <= 100 &&
        ((window as WindowStatus).resetsAt === null ||
          Number.isInteger((window as WindowStatus).resetsAt)),
    ) &&
    Array.isArray(profile.activeSessions) &&
    profile.activeSessions.every(
      (session: unknown) => typeof session === "string" && session.length <= 64,
    )
  );
}

export function parseCodexStatus(raw: string): CodexStatus {
  if (raw.length > 16_384) throw new Error("Codex status response too large");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid Codex status response");
  const status = value as Record<string, unknown>;
  const profiles = status.profiles as Record<string, unknown> | undefined;
  if (
    typeof status.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(status.checkedAt)) ||
    !profiles ||
    !isProfile(profiles.codex) ||
    !isProfile(profiles.codex2)
  ) {
    throw new Error("Invalid Codex status response");
  }
  const cleanProfile = (profile: ProfileStatus): ProfileStatus => ({
    state: profile.state,
    remainingPercent: profile.remainingPercent,
    windows: profile.windows.map((window) => ({
      name: window.name,
      remainingPercent: window.remainingPercent,
      resetsAt: window.resetsAt,
    })),
    activeSessions: [...profile.activeSessions],
  });
  return {
    checkedAt: status.checkedAt,
    profiles: {
      codex: cleanProfile(profiles.codex),
      codex2: cleanProfile(profiles.codex2),
    },
  };
}

async function readStatus(
  hostId: number,
  userId: string,
): Promise<CodexStatus> {
  const cached = cache.get(hostId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inflight = pending.get(hostId);
  if (inflight) return inflight;
  const operation = (async () => {
    const host = await resolveHostById(hostId, userId);
    if (!host) throw new Error("Host is not available");
    const execution = withConnection(
      getFleetPoolKey(host),
      createFleetSshFactory(host, { readyTimeoutMs: TIMEOUT_MS }),
      (client) => execCommand(client, COMMAND),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        execution,
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Codex status timeout")),
            TIMEOUT_MS,
          );
        }),
      ]);
      const value = parseCodexStatus(output);
      cache.set(hostId, { value, expiresAt: Date.now() + CACHE_MS });
      return value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  pending.set(hostId, operation);
  try {
    return await operation;
  } finally {
    pending.delete(hostId);
  }
}

router.get(
  "/hosts/:hostId/codex-status",
  authenticateJWT,
  requireDataAccess,
  requireAdmin,
  async (req: Request, res: Response) => {
    const hostId = Number(req.params.hostId);
    if (!Number.isSafeInteger(hostId) || hostId <= 0) {
      res
        .status(400)
        .json({ error: { code: "INVALID_HOST_ID", message: "Invalid host" } });
      return;
    }
    try {
      res.json({
        data: await readStatus(hostId, (req as AuthenticatedRequest).userId),
      });
    } catch {
      res.status(503).json({
        error: {
          code: "CODEX_STATUS_UNAVAILABLE",
          message: "Codex status unavailable",
        },
      });
    }
  },
);

export default router;
