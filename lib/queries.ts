import "server-only";
import { getDb } from "./db";
import { addDaysIso } from "./dates";
import { ensurePerson } from "./meetings";

/**
 * Read models for the Tasks, Weekly digest and Today pages.
 * Callers must `await connection()` first (cacheComponents would otherwise freeze the result).
 */

export interface Task {
  id: number;
  title: string;
  description: string | null;
  owner: string | null;
  dueDate: string | null;
  status: "proposed" | "confirmed" | "done" | "dropped";
  notionUrl: string | null;
  notionStatus: "sending" | "sent" | "failed" | "needs_update" | null;
  notionError: string | null;
  approved: number; // 1 when approved for Notion
  meetingTitle: string;
  meetingDate: string;
  /** YYYY-MM-DD (UTC) of the last change, used for "done this week". */
  updatedOn: string;
}

export type TaskStatusFilter = "open" | "done" | "all";
export const DUE_FILTERS = ["any", "overdue", "soon", "week", "later", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
export const UNASSIGNED = "unassigned";

const OPEN = "a.status IN ('proposed', 'confirmed')";

const TASK_SELECT = `
  SELECT a.id, a.title, a.description, p.name AS owner, a.due_date AS dueDate, a.status,
         a.notion_url AS notionUrl, a.notion_status AS notionStatus, a.notion_error AS notionError,
         (a.approved_at IS NOT NULL) AS approved, m.title AS meetingTitle, m.meeting_date AS meetingDate,
         date(a.updated_at) AS updatedOn
  FROM action_items a
  JOIN meetings m ON m.id = a.meeting_id
  LEFT JOIN people p ON p.id = a.owner_id`;

export function listTasks(filter: { status: TaskStatusFilter; owner?: string; due?: DueFilter; today?: string }): Task[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const today = filter.today;
  if (today && filter.due && filter.due !== "any") {
    if (filter.due === "overdue") where.push(`a.due_date < '${today}'`);
    else if (filter.due === "soon") where.push(`a.due_date BETWEEN '${today}' AND '${addDaysIso(today, 2)}'`);
    else if (filter.due === "week") where.push(`a.due_date BETWEEN '${today}' AND '${addDaysIso(today, 7)}'`);
    else if (filter.due === "later") where.push(`a.due_date > '${addDaysIso(today, 7)}'`);
    else if (filter.due === "none") where.push("a.due_date IS NULL");
  }
  if (filter.status === "open") where.push(OPEN);
  else if (filter.status === "done") where.push("a.status = 'done'");
  else where.push("a.status != 'dropped'");
  if (filter.owner === UNASSIGNED) where.push("a.owner_id IS NULL");
  else if (filter.owner) {
    where.push("p.name = ?");
    params.push(filter.owner);
  }
  const order =
    filter.status === "done"
      ? "a.updated_at DESC, a.id DESC"
      : "a.status = 'done', a.due_date IS NULL, a.due_date, a.id";
  return getDb()
    .prepare(`${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order}`)
    .all(...params) as Task[];
}

export function taskCounts(owner?: string): Record<TaskStatusFilter, number> {
  const ownerSql = owner === UNASSIGNED ? "AND a.owner_id IS NULL" : owner ? "AND p.name = ?" : "";
  const row = getDb()
    .prepare(
      `SELECT SUM(${OPEN}) AS open, SUM(a.status = 'done') AS done, SUM(a.status != 'dropped') AS total
       FROM action_items a LEFT JOIN people p ON p.id = a.owner_id WHERE 1 ${ownerSql}`,
    )
    .get(...(owner && owner !== UNASSIGNED ? [owner] : [])) as { open: number | null; done: number | null; total: number | null };
  return { open: row.open ?? 0, done: row.done ?? 0, all: row.total ?? 0 };
}

/** People who own at least one task, plus how many open tasks they have. */
export function taskOwners(): { name: string; open: number }[] {
  return getDb()
    .prepare(
      `SELECT p.name, SUM(${OPEN}) AS open
       FROM action_items a JOIN people p ON p.id = a.owner_id
       WHERE a.status != 'dropped'
       GROUP BY p.id ORDER BY open DESC, p.name`,
    )
    .all() as { name: string; open: number }[];
}

export function unassignedOpenCount(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM action_items a WHERE ${OPEN} AND a.owner_id IS NULL`).get() as { n: number }).n;
}

export function allPeopleNames(): string[] {
  return (getDb().prepare("SELECT name FROM people ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

// --- Mutations ------------------------------------------------------------------

export function setTaskDone(id: number, done: boolean): boolean {
  const info = getDb()
    .prepare(
      `UPDATE action_items SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND status != 'dropped'`,
    )
    .run(done ? "done" : "confirmed", id);
  return info.changes > 0;
}

export function updateTaskDetails(id: number, details: { owner: string; dueDate: string }): boolean {
  const ownerId = ensurePerson(details.owner);
  const info = getDb()
    .prepare(
      `UPDATE action_items SET owner_id = ?, due_date = ?, updated_at = datetime('now'),
         notion_status = CASE WHEN notion_status = 'sent' THEN 'needs_update' ELSE notion_status END
       WHERE id = ?`,
    )
    .run(ownerId, details.dueDate || null, id);
  return info.changes > 0;
}

// --- Conflicts + decision history ----------------------------------------------

export interface OpenConflict {
  id: number;
  type: string;
  explanation: string;
  newText: string;
  meetingTitle: string;
  meetingDate: string;
  oldText: string | null;
  oldMeetingTitle: string | null;
  oldMeetingDate: string | null;
}

/** Conflicts the team chose to "discuss later" and hasn't settled yet. */
export function openConflicts(): OpenConflict[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.type, c.explanation, c.new_text AS newText,
              m.title AS meetingTitle, m.meeting_date AS meetingDate,
              COALESCE(od.text, oa.title) AS oldText,
              om.title AS oldMeetingTitle, om.meeting_date AS oldMeetingDate
       FROM conflicts c
       JOIN meetings m ON m.id = c.meeting_id
       LEFT JOIN decisions od ON od.id = c.old_decision_id
       LEFT JOIN action_items oa ON oa.id = c.old_action_id
       LEFT JOIN meetings om ON om.id = COALESCE(od.meeting_id, oa.meeting_id)
       WHERE c.status = 'open'
       ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all() as OpenConflict[];
}

export function settleConflict(id: number): boolean {
  return (
    getDb()
      .prepare("UPDATE conflicts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND status = 'open'")
      .run(id).changes > 0
  );
}

export interface HistoryDecision {
  id: number;
  text: string;
  rationale: string | null;
  owner: string | null;
  status: "proposed" | "active" | "superseded" | "reversed";
  replacedByText: string | null;
  replacedInTitle: string | null;
  replacedInDate: string | null;
  openConflict: number; // 1 when under "discuss later"
}

export interface HistoryMeeting {
  id: number;
  title: string;
  date: string;
  decisions: HistoryDecision[];
}

/** Every meeting (newest first) with its decisions, including replaced ones. */
export function decisionHistory(): HistoryMeeting[] {
  const db = getDb();
  const meetings = db
    .prepare("SELECT id, title, meeting_date AS date FROM meetings ORDER BY meeting_date DESC, id DESC")
    .all() as Omit<HistoryMeeting, "decisions">[];
  const rows = db
    .prepare(
      `SELECT d.id, d.meeting_id AS meetingId, d.text, d.rationale, p.name AS owner, d.status,
              nd.text AS replacedByText, rm.title AS replacedInTitle, rm.meeting_date AS replacedInDate,
              EXISTS (SELECT 1 FROM conflicts c WHERE c.status = 'open'
                      AND (c.old_decision_id = d.id OR c.new_decision_id = d.id)) AS openConflict
       FROM decisions d
       LEFT JOIN people p ON p.id = d.owner_id
       LEFT JOIN decisions nd ON nd.id = d.superseded_by
       LEFT JOIN meetings rm ON rm.id = d.replaced_in_meeting_id
       ORDER BY d.id`,
    )
    .all() as (HistoryDecision & { meetingId: number })[];
  return meetings.map((m) => ({ ...m, decisions: rows.filter((r) => r.meetingId === m.id) }));
}

// --- Dashboard / reminders --------------------------------------------------------

export function dashboardStats(today: string) {
  return getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM meetings) AS meetings,
              (SELECT COUNT(*) FROM action_items a WHERE ${OPEN}) AS open,
              (SELECT COUNT(*) FROM action_items a WHERE ${OPEN} AND a.due_date < ?) AS overdue,
              (SELECT COUNT(*) FROM action_items a WHERE ${OPEN} AND a.due_date BETWEEN ? AND ?) AS dueSoon,
              (SELECT COUNT(*) FROM conflicts WHERE status = 'open') AS conflicts`,
    )
    .get(today, today, addDaysIso(today, 2)) as { meetings: number; open: number; overdue: number; dueSoon: number; conflicts: number };
}

/** Open tasks that are overdue or due within the next 48 hours (today, tomorrow, the day after). */
export function reminders(today: string): Task[] {
  return getDb()
    .prepare(`${TASK_SELECT} WHERE ${OPEN} AND a.due_date IS NOT NULL AND a.due_date <= ? ORDER BY a.due_date, a.id`)
    .all(addDaysIso(today, 2)) as Task[];
}

export function reminderCount(today: string): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM action_items a WHERE ${OPEN} AND a.due_date IS NOT NULL AND a.due_date <= ?`)
      .get(addDaysIso(today, 2)) as { n: number }
  ).n;
}

export interface RecentMeeting {
  id: number;
  title: string;
  date: string;
  decisions: number;
  tasks: number;
  attendees: string[];
}

export function recentMeetings(limit = 5): RecentMeeting[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.meeting_date AS date,
              (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decisions,
              (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id AND a.status != 'dropped') AS tasks,
              (SELECT GROUP_CONCAT(p.name, '|') FROM meeting_attendees ma JOIN people p ON p.id = ma.person_id WHERE ma.meeting_id = m.id) AS names
       FROM meetings m ORDER BY m.meeting_date DESC, m.id DESC LIMIT ?`,
    )
    .all(limit) as (Omit<RecentMeeting, "attendees"> & { names: string | null })[];
  return rows.map(({ names, ...m }) => ({ ...m, attendees: names ? names.split("|") : [] }));
}

// --- Per-person facts for the AI weekly digest ----------------------------------------

export interface PersonFacts {
  name: string;
  overdue: Task[];
  open: Task[];
  doneThisWeek: Task[];
  decisions: { text: string; meetingTitle: string; meetingDate: string }[];
  discuss: { explanation: string; meetingTitle: string }[];
}

/** Everything the digest may mention for one person. Last 7 days for "done", 14 days for decisions. */
export function personFacts(name: string, today: string): PersonFacts | null {
  const db = getDb();
  const person = db.prepare("SELECT id, name FROM people WHERE name = ?").get(name) as { id: number; name: string } | undefined;
  if (!person) return null;
  const weekAgo = addDaysIso(today, -6);
  const tasks = db
    .prepare(`${TASK_SELECT} WHERE a.owner_id = ? AND a.status != 'dropped' ORDER BY a.due_date IS NULL, a.due_date, a.id`)
    .all(person.id) as Task[];
  const isOpen = (t: Task) => t.status === "proposed" || t.status === "confirmed";
  const decisions = db
    .prepare(
      `SELECT DISTINCT d.text, m.title AS meetingTitle, m.meeting_date AS meetingDate
       FROM decisions d JOIN meetings m ON m.id = d.meeting_id
       LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id AND ma.person_id = ?
       WHERE d.status IN ('active', 'proposed') AND m.meeting_date >= ? AND (ma.person_id IS NOT NULL OR d.owner_id = ?)
       ORDER BY m.meeting_date DESC, d.id`,
    )
    .all(person.id, addDaysIso(today, -14), person.id) as PersonFacts["decisions"];
  const discuss = db
    .prepare(
      `SELECT DISTINCT c.explanation, m.title AS meetingTitle
       FROM conflicts c JOIN meetings m ON m.id = c.meeting_id
       LEFT JOIN decisions od ON od.id = c.old_decision_id
       LEFT JOIN decisions nd ON nd.id = c.new_decision_id
       LEFT JOIN action_items oa ON oa.id = c.old_action_id
       LEFT JOIN action_items na ON na.id = c.new_action_id
       LEFT JOIN meeting_attendees ma ON ma.meeting_id = c.meeting_id AND ma.person_id = ?
       WHERE c.status = 'open'
         AND (ma.person_id IS NOT NULL OR ? IN (od.owner_id, nd.owner_id, oa.owner_id, na.owner_id))`,
    )
    .all(person.id, person.id) as PersonFacts["discuss"];
  return {
    name: person.name,
    overdue: tasks.filter((t) => isOpen(t) && t.dueDate !== null && t.dueDate < today),
    open: tasks.filter((t) => isOpen(t) && (t.dueDate === null || t.dueDate >= today)),
    doneThisWeek: tasks.filter((t) => t.status === "done" && t.updatedOn >= weekAgo),
    decisions,
    discuss,
  };
}

export interface SavedDigest {
  content: string;
  createdAt: string;
}

export function savedDigest(name: string, date: string): SavedDigest | null {
  return (
    (getDb()
      .prepare(
        `SELECT g.content, g.created_at AS createdAt FROM digests g JOIN people p ON p.id = g.person_id
         WHERE p.name = ? AND g.digest_date = ?`,
      )
      .get(name, date) as SavedDigest | undefined) ?? null
  );
}

export function saveDigest(name: string, date: string, content: string) {
  getDb()
    .prepare(
      `INSERT INTO digests (person_id, digest_date, content)
       SELECT id, ?, ? FROM people WHERE name = ?
       ON CONFLICT(person_id, digest_date) DO UPDATE SET content = excluded.content, created_at = datetime('now')`,
    )
    .run(date, content, name);
}
