import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

// SQLite file lives in ./data (git-ignored). Override with DATABASE_PATH if needed.
const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "momentum.db");

// Reuse one connection across dev hot-reloads.
const globalForDb = globalThis as unknown as { __momentumDb?: Database.Database };

/**
 * Returns the shared SQLite connection, creating the file and tables on first use.
 *
 * IMPORTANT (cacheComponents is on): better-sqlite3 is synchronous, so a read in a
 * Server Component would otherwise run at build time and be frozen into the page.
 * Call `await connection()` from "next/server" before reading in pages/route handlers.
 */
export function getDb(): Database.Database {
  if (globalForDb.__momentumDb) return globalForDb.__momentumDb;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  migrate(db);

  globalForDb.__momentumDb = db;
  return db;
}

/** Small additive migrations for databases created before a column existed. */
function migrate(db: Database.Database) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn("decisions", "replaced_in_meeting_id", "replaced_in_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL");
  addColumn("action_items", "replaced_in_meeting_id", "replaced_in_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL");
  addColumn("action_items", "notion_status", "notion_status TEXT");
  addColumn("action_items", "notion_error", "notion_error TEXT");
  addColumn("action_items", "notion_synced_at", "notion_synced_at TEXT");
  addColumn("action_items", "approved_at", "approved_at TEXT");
}
