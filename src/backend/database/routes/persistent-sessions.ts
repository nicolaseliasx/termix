import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { apiLogger } from "../../utils/logger.js";
import {
  createCurrentHostResolutionRepository,
  createCurrentPersistentSessionRepository,
} from "../repositories/factory.js";
import {
  asPersistentSessionError,
  PersistentSessionError,
} from "../../hosts/sessions/errors.js";
import { SshPersistentSessionGateway } from "../../hosts/sessions/gateway.js";
import { PersistentSessionLifecycleService } from "../../hosts/sessions/lifecycle.js";
import { PersistentSessionReconciler } from "../../hosts/sessions/reconciler.js";
import { resolveHostById } from "../../hosts/host-resolver.js";

const router = express.Router();
const auth = AuthManager.getInstance();
const authenticateJWT = auth.createAuthMiddleware();
const requireDataAccess = auth.createDataAccessMiddleware();
function service() {
  return new PersistentSessionLifecycleService(
    createCurrentPersistentSessionRepository(),
    new SshPersistentSessionGateway(),
  );
}
function reconciler() {
  return new PersistentSessionReconciler(
    createCurrentPersistentSessionRepository(),
    new SshPersistentSessionGateway(),
    async () =>
      (await createCurrentHostResolutionRepository().listAllHosts()).map(
        (host) => ({ id: host.id, userId: host.userId }),
      ),
    resolveHostById,
  );
}
function fail(res: Response, error: unknown): void {
  const typed = asPersistentSessionError(error);
  if (!(error instanceof PersistentSessionError))
    apiLogger.warn("Persistent session request failed", {
      operation: "persistent_session_request",
      code: typed.code,
    });
  res.status(typed.status).json({
    error: {
      code: typed.code,
      message: typed.message,
      ...(typed.details ? { details: typed.details } : {}),
    },
  });
}
function page(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : fallback;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}
function param(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

router.get(
  "/persistent-sessions",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, page(req.query.limit, 50, 100));
      const offset = page(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const result = await service().list(
        (req as AuthenticatedRequest).userId,
        limit,
        offset,
        req.query.includeEnded === "true",
      );
      res.json({
        data: result.data,
        meta: { total: result.total, limit, offset },
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  "/persistent-sessions",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      const record = await service().create(
        (req as AuthenticatedRequest).userId,
        req.body ?? {},
      );
      res.status(201).json({ data: record });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  "/persistent-sessions/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      res.json({
        data: await service().get(
          param(req.params.id),
          (req as AuthenticatedRequest).userId,
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.patch(
  "/persistent-sessions/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      res.json({
        data: await service().patch(
          param(req.params.id),
          (req as AuthenticatedRequest).userId,
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.delete(
  "/persistent-sessions/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      res.json({
        data: await service().kill(
          param(req.params.id),
          (req as AuthenticatedRequest).userId,
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  "/persistent-session-adoptions",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      res.status(201).json({
        data: await service().adopt(
          (req as AuthenticatedRequest).userId,
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  "/persistent-session-reconciliations",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const hosts =
        await createCurrentHostResolutionRepository().listAllHosts();
      // Resolve as the caller so shared-host permissions are honoured and no
      // inaccessible host can be scanned or exposed in the response.
      const result = await reconciler().reconcileHosts(
        hosts.map((host) => ({ id: host.id, userId })),
      );
      res.json({ data: { hosts: result.results } });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  "/hosts/:hostId/persistent-session-reconciliations",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Number(req.params.hostId);
    if (!Number.isInteger(hostId) || hostId < 1)
      return fail(
        res,
        new PersistentSessionError("PERSISTENT_SESSION_INVALID_REQUEST"),
      );
    try {
      res.json({
        data: await service().refresh(
          hostId,
          (req as AuthenticatedRequest).userId,
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
export default router;
