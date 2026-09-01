/** Confirmation-based monitor for backend availability. */
import { normalizeApiErrorPayload } from "./api-error-payload";

type EventListener = (...args: unknown[]) => void;
type HealthProbe = (signal: AbortSignal) => Promise<boolean>;

interface HttpLikeError {
  message?: string;
  code?: string;
  name?: string;
  response?: {
    data?: unknown;
  };
  config?: { signal?: AbortSignal };
}

const PROBE_TIMEOUT_MS = 3_000;
const CONFIRMATION_GAP_MS = 2_000;
const RETRY_DELAYS_MS = [5_000, 10_000, 30_000];

class DatabaseHealthMonitor {
  private static instance: DatabaseHealthMonitor;
  private listeners = new Map<string, EventListener[]>();
  private degradedActive = false;
  private confirmation: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryFlight: Promise<boolean> | null = null;
  private retryAttempt = 0;
  private probe: HealthProbe = async (signal) => {
    const response = await fetch("/health", {
      credentials: "include",
      signal,
    });
    return response.ok;
  };

  private constructor() {}

  static getInstance(): DatabaseHealthMonitor {
    return (DatabaseHealthMonitor.instance ??= new DatabaseHealthMonitor());
  }

  setHealthProbe(probe: HealthProbe): void {
    this.probe = probe;
  }

  on(event: string, listener: EventListener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: EventListener): void {
    const listeners = this.listeners.get(event);
    const index = listeners?.indexOf(listener) ?? -1;
    if (listeners && index >= 0) listeners.splice(index, 1);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }

  reportSessionExpired() {
    this.emit("session-expired", { timestamp: Date.now() });
  }

  reportDatabaseError(error: unknown): void {
    const errorLike = error as HttpLikeError;
    const responseError = normalizeApiErrorPayload(errorLike.response?.data);
    const errorMessage =
      responseError.message ||
      (typeof errorLike.message === "string" ? errorLike.message : "");
    const errorCode = responseError.code || errorLike.code;
    const lowerMessage = errorMessage.toLowerCase();
    const cancelled =
      errorCode === "ERR_CANCELED" ||
      errorLike.name === "CanceledError" ||
      errorLike.name === "AbortError" ||
      errorLike.config?.signal?.aborted ||
      lowerMessage.includes("canceled") ||
      lowerMessage.includes("cancelled") ||
      lowerMessage.includes("aborted");
    if (cancelled) return;

    const isDatabaseError =
      lowerMessage.includes("database") ||
      lowerMessage.includes("sqlite") ||
      lowerMessage.includes("drizzle") ||
      errorCode === "DATABASE_ERROR" ||
      errorCode === "DB_CONNECTION_FAILED";

    const isBackendUnreachable =
      errorCode === "ERR_NETWORK" ||
      errorCode === "ECONNREFUSED" ||
      errorCode === "ECONNABORTED" ||
      errorCode === "ECONNRESET" ||
      errorCode === "ETIMEDOUT" ||
      (lowerMessage.includes("network error") &&
        errorLike.response === undefined) ||
      lowerMessage.includes("timeout");

    // An explicit database error is already a backend-originated diagnosis;
    // retain the existing immediate signal for callers that handle this
    // distinct case. Transport/network suspicions require health confirmation.
    if (isDatabaseError && !this.degradedActive) {
      this.activateDegraded(errorMessage || "Database request failed");
      return;
    }

    if (
      !(isDatabaseError || isBackendUnreachable) ||
      this.degradedActive ||
      this.confirmation
    ) {
      return;
    }

    this.confirmation = this.confirmOutage(
      errorMessage || "Background request failed",
    )
      .catch(() => {})
      .finally(() => {
        this.confirmation = null;
      });
  }

  private async runProbe(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      return await this.probe(controller.signal);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async confirmOutage(message: string): Promise<void> {
    if (await this.runProbe()) return;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, CONFIRMATION_GAP_MS),
    );
    if (await this.runProbe()) return;
    this.activateDegraded(message);
  }

  private activateDegraded(message: string): void {
    if (this.degradedActive) return;
    this.degradedActive = true;
    this.retryAttempt = 0;
    this.emit("database-connection-degraded", {
      error: message,
      timestamp: Date.now(),
    });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.degradedActive || this.retryTimer) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryHealth();
    }, delay);
  }

  async retryHealth(): Promise<boolean> {
    if (!this.degradedActive) return true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retryFlight) return this.retryFlight;
    this.retryFlight = this.runProbe()
      .then((healthy) => {
        if (!healthy) return false;
        this.degradedActive = false;
        this.retryAttempt = 0;
        this.emit("database-connection-degraded-cleared", {
          timestamp: Date.now(),
        });
        return true;
      })
      .finally(() => {
        this.retryFlight = null;
      });
    const healthy = await this.retryFlight;
    if (!healthy) this.scheduleRetry();
    return healthy;
  }

  /** Kept for interceptor compatibility; only /health may clear degraded. */
  reportDatabaseSuccess(): void {
    // Intentionally do nothing.
  }

  isDegraded(): boolean {
    return this.degradedActive;
  }

  reset(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.confirmation = null;
    this.retryFlight = null;
    this.degradedActive = false;
    this.retryAttempt = 0;
  }
}

export const dbHealthMonitor = DatabaseHealthMonitor.getInstance();
