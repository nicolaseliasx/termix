import { afterEach, describe, expect, it, vi } from "vitest";
import { dbHealthMonitor } from "@/lib/db-health-monitor";

describe("dbHealthMonitor", () => {
  afterEach(() => dbHealthMonitor.reset());

  it("accepts typed nested API errors without throwing", () => {
    expect(() =>
      dbHealthMonitor.reportDatabaseError({
        response: {
          data: {
            error: {
              code: "PERSISTENT_SESSION_REMOTE_UNAVAILABLE",
              message: "Remote host is unavailable",
            },
          },
        },
      }),
    ).not.toThrow();
    expect(dbHealthMonitor.isDegraded()).toBe(false);
  });

  it("still reports nested database errors", () => {
    const listener = vi.fn();
    dbHealthMonitor.on("database-connection-degraded", listener);

    dbHealthMonitor.reportDatabaseError({
      response: {
        data: {
          error: { code: "DATABASE_ERROR", message: "Database unavailable" },
        },
      },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(dbHealthMonitor.isDegraded()).toBe(true);
    dbHealthMonitor.off("database-connection-degraded", listener);
  });
});
