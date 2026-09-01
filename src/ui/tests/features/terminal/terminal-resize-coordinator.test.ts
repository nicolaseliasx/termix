import { describe, expect, it } from "vitest";
import {
  TerminalResizeCoordinator,
  type TerminalDimensions,
} from "@/features/terminal/terminal-resize-coordinator";

const initialSize: TerminalDimensions = { cols: 80, rows: 24 };

describe("TerminalResizeCoordinator", () => {
  it("queues a resize recorded before the remote is ready", () => {
    const coordinator = new TerminalResizeCoordinator();
    coordinator.beginConnection(initialSize);
    coordinator.record({ cols: 100, rows: 30 });

    expect(coordinator.takePendingResize()).toBeNull();
    coordinator.markRemoteReady();
    expect(coordinator.takePendingResize()).toEqual({ cols: 100, rows: 30 });
  });

  it("deduplicates the initial dimensions and already returned dimensions", () => {
    const coordinator = new TerminalResizeCoordinator();
    coordinator.beginConnection(initialSize);
    coordinator.markRemoteReady();
    coordinator.record(initialSize);
    expect(coordinator.takePendingResize()).toBeNull();

    coordinator.record({ cols: 100, rows: 30 });
    expect(coordinator.takePendingResize()).toEqual({ cols: 100, rows: 30 });
    expect(coordinator.takePendingResize()).toBeNull();
  });

  it("returns only the latest recorded size", () => {
    const coordinator = new TerminalResizeCoordinator();
    coordinator.beginConnection(initialSize);
    coordinator.record({ cols: 90, rows: 25 });
    coordinator.record({ cols: 110, rows: 35 });
    coordinator.markRemoteReady();

    expect(coordinator.takePendingResize()).toEqual({ cols: 110, rows: 35 });
  });

  it("resets state for a reconnect", () => {
    const coordinator = new TerminalResizeCoordinator();
    coordinator.beginConnection(initialSize);
    coordinator.markRemoteReady();
    coordinator.record({ cols: 100, rows: 30 });
    expect(coordinator.takePendingResize()).toEqual({ cols: 100, rows: 30 });

    coordinator.reset();
    coordinator.beginConnection({ cols: 120, rows: 40 });
    coordinator.markRemoteReady();
    coordinator.record({ cols: 100, rows: 30 });
    expect(coordinator.takePendingResize()).toEqual({ cols: 100, rows: 30 });
  });

  it("never returns invalid dimensions", () => {
    const coordinator = new TerminalResizeCoordinator();
    coordinator.beginConnection(initialSize);
    coordinator.record({ cols: 0, rows: 24 });
    coordinator.record({ cols: 80, rows: -1 });
    coordinator.markRemoteReady();

    expect(coordinator.takePendingResize()).toBeNull();
  });
});
