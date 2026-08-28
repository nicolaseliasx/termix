import { afterEach, describe, expect, it } from "vitest";
import { PersistentSessionRepository } from "../../../database/repositories/persistent-session-repository.js";
import { TestSqliteDatabase } from "./test-support.js";

describe("PersistentSessionRepository", () => {
  let database: TestSqliteDatabase | undefined;
  async function repository(): Promise<PersistentSessionRepository> {
    database = new TestSqliteDatabase();
    const context = await database.connect();
    await database.exec(`
      INSERT INTO users (id, username, password_hash) VALUES ('owner', 'owner', 'hash'), ('other', 'other', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type) VALUES (1, 'owner', 'host', '127.0.0.1', 22, 'root', 'none');
    `);
    return new PersistentSessionRepository(context);
  }
  afterEach(async () => database?.close());
  it("is owner-scoped and prevents a second active host/tmux name", async () => {
    const repo = await repository();
    const input = {
      id: "one",
      userId: "owner",
      hostId: 1,
      displayName: "One",
      tmuxSessionName: "one",
      managementState: "managed" as const,
      expiryMode: "manual" as const,
    };
    await repo.create(input);
    expect(await repo.findByIdForUser("one", "other")).toBeNull();
    await expect(
      repo.create({ ...input, id: "two", userId: "other" }),
    ).rejects.toThrow("PERSISTENT_SESSION_CONFLICT");
    expect((await repo.listByUser("owner")).total).toBe(1);
  });
  it("keeps terminal transitions idempotent", async () => {
    const repo = await repository();
    await repo.create({
      id: "one",
      userId: "owner",
      hostId: 1,
      displayName: "One",
      tmuxSessionName: "one",
      managementState: "managed",
      expiryMode: "manual",
    });
    const ended = await repo.markEnded("one", "owner", "killed");
    expect(ended?.endReason).toBe("killed");
    expect((await repo.markEnded("one", "owner", "expired"))?.endReason).toBe(
      "killed",
    );
  });
});
