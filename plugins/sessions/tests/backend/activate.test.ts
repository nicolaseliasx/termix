import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix-ssh/plugin-sdk/testing";
import manifest from "../../manifest.json" with { type: "json" };
import { activate } from "../../src/backend/index.js";
import { sessions } from "../../src/backend/tables.js";
import { SessionRepository } from "../../src/backend/repository.js";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let testDb: TestDb | undefined;
afterEach(() => testDb?.close());

describe("activate", () => {
  it("mounts the routes behind the use permission and schedules the background pass", async () => {
    testDb = await createTestDb(pluginDir);
    let router: express.Router | null = null;
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest: manifest as never,
      capabilities: manifest.capabilities,
      db: testDb.database,
      router: () => (router = express.Router()),
      permissions: ["sessions.use"],
    });
    await activate(mock.ctx);
    expect(router).not.toBeNull();
    expect(
      (router as unknown as { stack: unknown[] }).stack.length,
    ).toBeGreaterThanOrEqual(8);
    expect(mock.checked).toEqual(expect.arrayContaining(["db:own"]));
  });

  // The timer has no request, so the background pass acts as each session's
  // owner through ctx.asUser. Without users:impersonate core refused it every
  // minute: the pass never ran and each refusal wrote an audit row.
  it("lets the background pass act as the session owner", async () => {
    testDb = await createTestDb(pluginDir);
    testDb.sqlite.exec("INSERT INTO users (id, username) VALUES ('u1','one')");
    testDb.sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest: manifest as never,
      capabilities: manifest.capabilities,
      db: testDb.database,
      router: () => express.Router(),
      permissions: ["sessions.use"],
    });
    await activate(mock.ctx);
    const table = await mock.ctx.db.define(sessions);
    const repo = new SessionRepository(
      (await mock.ctx.db.client()) as never,
      table as never,
      () => mock.ctx.db.persist(),
    );
    await repo.create({
      id: "s1",
      userId: "u1",
      hostId: 1,
      displayName: "Work",
      tmuxSessionName: "work",
      managementState: "managed",
      expiryMode: "manual",
    });
    const refused: unknown[] = [];
    const original = mock.ctx.asUser;
    mock.ctx.asUser = (async (userId: string, fn: () => unknown) => {
      try {
        return await original(userId, fn as never);
      } catch (error) {
        refused.push(error);
        throw error;
      }
    }) as typeof mock.ctx.asUser;
    await mock.runScheduled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.checked).toContain("users:impersonate");
    expect(refused).toEqual([]);
  });
});
