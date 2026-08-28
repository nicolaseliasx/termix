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

  it("converts active legacy idle sessions to sessions that never expire", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE ssh_data (id INTEGER PRIMARY KEY);",
    );
    applyPersistentSessionMigration(sqlite);
    sqlite.exec("INSERT INTO users (id) VALUES ('owner'); INSERT INTO ssh_data (id) VALUES (1);");
    sqlite
      .prepare(
        `INSERT INTO persistent_sessions (
          id, user_id, host_id, display_name, tmux_session_name,
          expiry_mode, expiry_seconds, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy",
        "owner",
        1,
        "Legacy session",
        "legacy-session",
        "idle",
        300,
        "2026-08-29T00:00:00.000Z",
      );

    applyPersistentSessionMigration(sqlite);

    expect(
      sqlite
        .prepare(
          "SELECT expiry_mode, expiry_seconds, expires_at FROM persistent_sessions WHERE id = ?",
        )
        .get("legacy"),
    ).toEqual({
      expiry_mode: "manual",
      expiry_seconds: null,
      expires_at: null,
    });
    sqlite.close();
  });
});
