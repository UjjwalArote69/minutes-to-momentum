// SQLite schema for Minutes to Momentum ("memory" across meetings).
// Applied idempotently on first DB access (see lib/db.ts).
// Dates are ISO strings: dates as 'YYYY-MM-DD', timestamps as 'YYYY-MM-DD HH:MM:SS' (UTC).

export const SCHEMA_SQL = /* sql */ `
-- People who attend meetings / own decisions and action items.
CREATE TABLE IF NOT EXISTS people (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email           TEXT,
  notion_user_id  TEXT,                       -- optional: for Notion "person" property
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per processed meeting recap / transcript.
CREATE TABLE IF NOT EXISTS meetings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  meeting_date      TEXT NOT NULL,            -- YYYY-MM-DD
  source            TEXT NOT NULL DEFAULT 'paste'
                    CHECK (source IN ('voice', 'paste')),
  raw_transcript    TEXT NOT NULL,            -- exactly what the user gave us
  clean_transcript  TEXT,                     -- AI-cleaned version (fillers removed etc.)
  summary           TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'confirmed')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who was in which meeting (drives per-person weekly digest).
CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  person_id   INTEGER NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, person_id)
);

-- Decisions extracted from meetings. Long-term memory for conflict detection.
CREATE TABLE IF NOT EXISTS decisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id     INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  rationale      TEXT,
  topic          TEXT,                        -- short tag to help match related decisions
  owner_id       INTEGER REFERENCES people(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('proposed', 'active', 'superseded', 'reversed')),
  superseded_by  INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  replaced_in_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL, -- meeting that replaced it
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- LEGACY (unused): decision-to-decision only. Conflicts now live in the \`conflicts\` table below.
CREATE TABLE IF NOT EXISTS decision_conflicts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  new_decision_id  INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  old_decision_id  INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  explanation      TEXT NOT NULL,
  resolution       TEXT NOT NULL DEFAULT 'pending'
                   CHECK (resolution IN ('pending', 'keep_new', 'keep_old', 'not_a_conflict')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (new_decision_id, old_decision_id)
);

-- Action items (tasks). status: proposed (saved, awaiting approval) -> confirmed (approved) -> done.
-- Approved tasks are created in Notion; notion_page_id is set once and never created again.
CREATE TABLE IF NOT EXISTS action_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id      INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  decision_id     INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  owner_id        INTEGER REFERENCES people(id) ON DELETE SET NULL,
  due_date        TEXT,                       -- YYYY-MM-DD, nullable if no deadline was said
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high')),
  status          TEXT NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'confirmed', 'done', 'dropped')),
  notion_page_id  TEXT,
  notion_url      TEXT,
  notion_status   TEXT,                       -- NULL (not sent) | sending | sent | failed | needs_update
  notion_error    TEXT,                       -- last friendly Notion error, for the Retry UI
  notion_synced_at TEXT,                      -- last send attempt / success (also the 'sending' lock time)
  approved_at     TEXT,                       -- set when the user approves the task for Notion
  replaced_in_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL, -- set when status = 'dropped' by a conflict
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conflicts found when a new meeting was compared with memory, and what the user chose.
-- resolution: replace_old (old item replaced, kept in history) | keep_old (new item not saved)
--             | discuss_later (both saved, conflict stays open until settled).
CREATE TABLE IF NOT EXISTS conflicts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id       INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, -- meeting where it was found
  type             TEXT NOT NULL CHECK (type IN ('contradicting_decision', 'changed_deadline',
                     'reassigned_owner', 'duplicate_task', 'scope_violation')),
  explanation      TEXT NOT NULL,
  new_text         TEXT NOT NULL,              -- snapshot, so history survives "keep old"
  new_decision_id  INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  new_action_id    INTEGER REFERENCES action_items(id) ON DELETE SET NULL,
  old_decision_id  INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  old_action_id    INTEGER REFERENCES action_items(id) ON DELETE SET NULL,
  resolution       TEXT NOT NULL CHECK (resolution IN ('replace_old', 'keep_old', 'discuss_later')),
  status           TEXT NOT NULL DEFAULT 'resolved' CHECK (status IN ('open', 'resolved')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at      TEXT
);

-- AI-written weekly digest per person per day (generated once, then reused).
CREATE TABLE IF NOT EXISTS digests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  digest_date  TEXT NOT NULL,                 -- YYYY-MM-DD it was written for
  content      TEXT NOT NULL,                 -- plain text, ready to paste into Slack or email
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (person_id, digest_date)
);

-- Cache of AI responses so repeated tests don't burn free Gemini quota.
CREATE TABLE IF NOT EXISTS ai_cache (
  key         TEXT PRIMARY KEY,               -- sha256 of model + prompt + schema
  model       TEXT NOT NULL,
  label       TEXT,                           -- e.g. 'extract', 'conflicts' (for debugging)
  response    TEXT NOT NULL,                  -- validated JSON string
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_meeting   ON decisions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status    ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_actions_owner_due   ON action_items(owner_id, due_date);
CREATE INDEX IF NOT EXISTS idx_actions_status_due  ON action_items(status, due_date);
CREATE INDEX IF NOT EXISTS idx_actions_meeting     ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_status    ON conflicts(status);
`;

export const TABLES = [
  "people",
  "meetings",
  "meeting_attendees",
  "decisions",
  "decision_conflicts",
  "action_items",
  "conflicts",
  "digests",
  "ai_cache",
] as const;
