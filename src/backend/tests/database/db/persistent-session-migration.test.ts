import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyPersistentSessionMigration } from "../../../database/db/persistent-session-migration.js";

describe("persistent session SQLite migration", () => {
  it("is additive and idempotent for fresh and upgraded databases", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE ssh_data (id INTEGER PRIMARY KEY);");
    applyPersistentSessionMigration(sqlite);
    applyPersistentSessionMigration(sqlite);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("persistent_sessions")).toBeTruthy();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("persistent_session_events")).toBeTruthy();
    sqlite.close();
  });
});
