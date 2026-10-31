import "server-only";
import { getDb } from "./db";
import type { ApprovalTask, SyncOutcome } from "./meeting-types";
import { NotionError, createTaskPage, notionDatabaseUrl, setTaskPageDone, updateTaskPage } from "./notion";

/**
 * Approve tasks and push them to Notion. Rules:
 * - A task needs an owner and a deadline before it can be approved.
 * - Nothing is ever created twice: a task with a Notion page is updated (when it changed) or skipped.
 *   Sending is claimed with an atomic 'sending' lock, and before creating we look for a page that
 *   already exists for the same task + meeting (lost responses, earlier demo takes).
 * - If Notion fails, the task stays in our database with the error, ready for Retry.
 */


interface Row {
  id: number;
  title: string;
  description: string | null;
  owner: string | null;
  dueDate: string | null;
  status: string;
  approvedAt: string | null;
  notionPageId: string | null;
  notionUrl: string | null;
  notionStatus: ApprovalTask["notionStatus"];
  notionError: string | null;
  meetingTitle: string;
  meetingDate: string;
}

const ROW_SELECT = `
  SELECT a.id, a.title, a.description, p.name AS owner, a.due_date AS dueDate, a.status,
         a.approved_at AS approvedAt, a.notion_page_id AS notionPageId, a.notion_url AS notionUrl,
         a.notion_status AS notionStatus, a.notion_error AS notionError,
         m.title AS meetingTitle, m.meeting_date AS meetingDate
  FROM action_items a JOIN meetings m ON m.id = a.meeting_id LEFT JOIN people p ON p.id = a.owner_id`;

/** The original sentence, stored as: From the meeting: "..." */
export function quoteFrom(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/^From the meeting: "([\s\S]*)"$/);
  return (m ? m[1] : description).trim() || null;
}

function toApproval(r: Row): ApprovalTask {
  return {
    id: r.id,
    title: r.title,
    owner: r.owner,
    dueDate: r.dueDate,
    quote: quoteFrom(r.description),
    status: r.status,
    approved: r.approvedAt !== null,
    notionStatus: r.notionStatus,
    notionUrl: r.notionUrl,
    notionError: r.notionError,
  };
}

/**
 * After a task is ticked done / undone here: mirror it to the Notion page's Status, if it has one.
 * On failure the task stays done locally and is marked needs_update (Retry from the Tasks page).
 */
export async function syncDoneStatus(id: number): Promise<{ ok: true; synced: boolean } | { ok: false; message: string }> {
  const db = getDb();
  const row = db
    .prepare("SELECT notion_page_id AS pageId, status FROM action_items WHERE id = ?")
    .get(id) as { pageId: string | null; status: string } | undefined;
  if (!row?.pageId) return { ok: true, synced: false };
  try {
    await setTaskPageDone(row.pageId, row.status === "done");
    db.prepare("UPDATE action_items SET notion_status = 'sent', notion_error = NULL, notion_synced_at = datetime('now') WHERE id = ?").run(id);
    return { ok: true, synced: true };
  } catch (err) {
    const message = err instanceof NotionError ? err.message : "Couldn't update Notion.";
    db.prepare("UPDATE action_items SET notion_status = 'needs_update', notion_error = ? WHERE id = ?").run(message, id);
    return { ok: false, message };
  }
}

export function meetingTasksForApproval(meetingId: number): ApprovalTask[] {
  return (
    getDb()
      .prepare(`${ROW_SELECT} WHERE a.meeting_id = ? AND a.status != 'dropped' ORDER BY a.id`)
      .all(meetingId) as Row[]
  ).map(toApproval);
}

export function taskForApproval(id: number): ApprovalTask | null {
  const row = getDb().prepare(`${ROW_SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  return row ? toApproval(row) : null;
}

export async function approveAndSend(ids: number[]): Promise<{ results: SyncOutcome[]; databaseUrl: string | null }> {
  const results: SyncOutcome[] = [];
  for (const id of [...new Set(ids)]) results.push(await syncOne(id)); // sequential: gentle on Notion's rate limit
  return { results, databaseUrl: results.some((r) => r.ok) ? await notionDatabaseUrl() : null };
}

async function syncOne(id: number): Promise<SyncOutcome> {
  const db = getDb();
  const row = db.prepare(`${ROW_SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  if (!row || row.status === "dropped") return { id, ok: false, kind: "not_found", message: "That task no longer exists." };
  if (!row.owner || !row.dueDate) {
    return { id, ok: false, kind: "needs_details", message: "Add an owner and a deadline before approving." };
  }

  // Approve (idempotent).
  db.prepare(
    `UPDATE action_items SET approved_at = COALESCE(approved_at, datetime('now')),
       status = CASE WHEN status = 'proposed' THEN 'confirmed' ELSE status END, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(id);

  if (row.notionPageId && row.notionStatus === "sent") {
    return { id, ok: true, action: "skipped", url: row.notionUrl ?? "" };
  }

  // Claim the task so a double click or a second tab can't send it twice (stale locks expire after 2 min).
  const claimed = db
    .prepare(
      `UPDATE action_items SET notion_status = 'sending', notion_synced_at = datetime('now')
       WHERE id = ? AND (notion_status IS NOT 'sending' OR notion_synced_at < datetime('now', '-2 minutes'))`,
    )
    .run(id).changes;
  if (!claimed) return { id, ok: true, action: "skipped", url: row.notionUrl ?? "" };

  const task = {
    title: row.title,
    owner: row.owner,
    dueDate: row.dueDate,
    meetingTitle: row.meetingTitle,
    meetingDate: row.meetingDate,
    quote: quoteFrom(row.description),
    done: row.status === "done",
  };

  try {
    let action: "created" | "updated";
    let pageId = row.notionPageId;
    let url = row.notionUrl ?? "";
    if (pageId) {
      // Already in Notion (e.g. a conflict choice changed its owner/deadline): update, never duplicate.
      ({ url } = await updateTaskPage(pageId, task, `Updated from "${row.meetingTitle}" (${row.meetingDate}): owner ${row.owner}, due ${row.dueDate}.`));
      url ||= row.notionUrl ?? "";
      action = "updated";
    } else {
      const created = await createTaskPage(task);
      pageId = created.pageId;
      url = created.url;
      action = created.adopted ? "updated" : "created";
      if (created.adopted) await updateTaskPage(pageId, task, null);
    }
    db.prepare(
      `UPDATE action_items SET notion_page_id = ?, notion_url = ?, notion_status = 'sent', notion_error = NULL,
         notion_synced_at = datetime('now') WHERE id = ?`,
    ).run(pageId, url, id);
    return { id, ok: true, action, url };
  } catch (err) {
    const e = err instanceof NotionError ? err : new NotionError(err instanceof Error ? err.message : String(err), "unknown");
    console.error("[notion]", id, e.kind, e.message);
    db.prepare(
      `UPDATE action_items SET notion_status = ?, notion_error = ?, notion_synced_at = datetime('now') WHERE id = ?`,
    ).run(row.notionPageId ? "needs_update" : "failed", e.message, id);
    return { id, ok: false, kind: e.kind, message: e.message };
  }
}
