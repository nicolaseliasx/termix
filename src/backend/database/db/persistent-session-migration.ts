import type Database from "better-sqlite3";
import { databaseLogger } from "../../utils/logger.js";

/** Additive and repeatable SQLite schema migration for persistent sessions. */
export function applyPersistentSessionMigration(sqlite: Database.Database): void {
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS persistent_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, host_id INTEGER NOT NULL,
        display_name TEXT NOT NULL, tmux_session_name TEXT NOT NULL,
        management_state TEXT NOT NULL DEFAULT 'managed', expiry_mode TEXT NOT NULL DEFAULT 'manual',
        expiry_seconds INTEGER, remote_created_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_attached_at TEXT, last_detached_at TEXT, expires_at TEXT, last_observed_at TEXT,
        hibernated_at TEXT,
        ended_at TEXT, end_reason TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS persistent_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, event_type TEXT NOT NULL,
        actor_id TEXT, client_id TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES persistent_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_persistent_sessions_user_active ON persistent_sessions(user_id, ended_at);
      CREATE INDEX IF NOT EXISTS idx_persistent_sessions_host_active ON persistent_sessions(host_id, ended_at);
      CREATE INDEX IF NOT EXISTS idx_persistent_sessions_expiry ON persistent_sessions(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_persistent_sessions_host_tmux_active ON persistent_sessions(host_id, tmux_session_name) WHERE ended_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_persistent_session_events_session_time ON persistent_session_events(session_id, created_at);
    `);
  } catch (error) {
    databaseLogger.warn("Failed to create persistent session tables", { operation: "schema_migration", error });
    throw error;
  }
  // The working directory is no longer part of a persistent session; drop the
  // legacy column from databases created before that change. Guarded so a
  // refusal (old SQLite without DROP COLUMN) never blocks startup.
  try {
    const columns = sqlite
      .prepare("PRAGMA table_info(persistent_sessions)")
      .all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "working_directory")) {
      sqlite.exec("ALTER TABLE persistent_sessions DROP COLUMN working_directory");
    }
  } catch (error) {
    databaseLogger.warn("Failed to drop persistent_sessions.working_directory", {
      operation: "schema_migration",
      error,
    });
  }
  // Hibernation bookkeeping: when a session's pane processes were frozen.
  // Additive column for databases created before idle hibernation existed.
  try {
    const columns = sqlite
      .prepare("PRAGMA table_info(persistent_sessions)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "hibernated_at")) {
      sqlite.exec(
        "ALTER TABLE persistent_sessions ADD COLUMN hibernated_at TEXT",
      );
    }
  } catch (error) {
    databaseLogger.warn("Failed to add persistent_sessions.hibernated_at", {
      operation: "schema_migration",
      error,
    });
  }
  // Sessions never expire: active rows created under an earlier expiry
  // policy are converted to manual so nothing sweeps them away later.
  try {
    sqlite.exec(`
      UPDATE persistent_sessions
      SET expiry_mode = 'manual', expiry_seconds = NULL, expires_at = NULL
      WHERE ended_at IS NULL
        AND (expiry_mode <> 'manual' OR expires_at IS NOT NULL)
    `);
  } catch (error) {
    databaseLogger.warn("Failed to neutralize persistent-session expiry", {
      operation: "schema_migration",
      error,
    });
  }
}
