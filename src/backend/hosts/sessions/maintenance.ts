import {
  createCurrentHostResolutionRepository,
  createCurrentPersistentSessionRepository,
} from "../../database/repositories/factory.js";
import { resolveHostById } from "../host-resolver.js";
import { SshPersistentSessionGateway } from "./gateway.js";
import { PersistentSessionReconciler } from "./reconciler.js";

export class PersistentSessionMaintenance {
  private readonly reconciler = new PersistentSessionReconciler(
    createCurrentPersistentSessionRepository(),
    new SshPersistentSessionGateway(),
    async () => {
      const hosts =
        await createCurrentHostResolutionRepository().listAllHosts();
      return hosts.map((host) => ({ id: host.id, userId: host.userId }));
    },
    resolveHostById,
  );
  start(): void {
    this.reconciler.start();
  }
  stop(): void {
    this.reconciler.stop();
  }
  runOnce() {
    return this.reconciler.runOnce();
  }
}
let maintenance: PersistentSessionMaintenance | undefined;
export function startPersistentSessionMaintenance(): PersistentSessionMaintenance {
  return (maintenance ??= new PersistentSessionMaintenance());
}
export function stopPersistentSessionMaintenance(): void {
  maintenance?.stop();
  maintenance = undefined;
}
