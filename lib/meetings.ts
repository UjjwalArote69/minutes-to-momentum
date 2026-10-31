import "server-only";
import { getDb } from "./db";
import type { saveMeetingInputSchema } from "./meeting-types";
import type { z } from "zod";

type SaveInput = z.output<typeof saveMeetingInputSchema>;

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Finds or creates a person by name (case-insensitive). Returns null for an empty name. */
export function ensurePerson(raw: string): number | null {
  const name = normalizeName(raw);
  if (!name) return null;
  const db = getDb();
  db.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING").run(name);
  return (db.prepare("SELECT id FROM people WHERE name = ?").get(name) as { id: number }).id;
}

/**
 * Saves a reviewed meeting in one transaction: the meeting, its people (matched by
 * name, case-insensitive), decisions (active), action items (confirmed, not yet in Notion)
 * and the conflicts found against memory with the user's choice for each:
 * - replace_old: the old decision becomes 'superseded' (kept in history, linked to this meeting
 *   and, when possible, to the new decision); an old task becomes 'dropped'.
 * - keep_old: the client already left the new item out; only the choice is recorded.
 * - replace_old on a task that is already in Notion: the new task inherits its Notion page.
 * - discuss_later: both stay; the conflict is stored as 'open' until someone settles it.
 */
export function saveMeeting(input: SaveInput) {
  const db = getDb();

  const insertPerson = db.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  const findPerson = db.prepare("SELECT id FROM people WHERE name = ?");
  const insertMeeting = db.prepare(
    `INSERT INTO meetings (title, meeting_date, source, raw_transcript, clean_transcript, summary, status)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`,
  );
  const insertAttendee = db.prepare(
    "INSERT OR IGNORE INTO meeting_attendees (meeting_id, person_id) VALUES (?, ?)",
  );
  const insertDecision = db.prepare(
    `INSERT INTO decisions (meeting_id, text, rationale, topic, status) VALUES (?, ?, ?, ?, 'active')`,
  );
  const insertAction = db.prepare(
    `INSERT INTO action_items (meeting_id, title, description, owner_id, due_date, status)
     VALUES (?, ?, ?, ?, ?, 'proposed')`, // approved later, on the Approve tasks step
  );

  const supersedeDecision = db.prepare(
    `UPDATE decisions SET status = 'superseded', superseded_by = ?, replaced_in_meeting_id = ?
     WHERE id = ? AND status IN ('active', 'proposed')`,
  );
  const dropTask = db.prepare(
    `UPDATE action_items SET status = 'dropped', replaced_in_meeting_id = ?, updated_at = datetime('now')
     WHERE id = ? AND status IN ('proposed', 'confirmed')`,
  );
  const insertConflict = db.prepare(
    `INSERT INTO conflicts (meeting_id, type, explanation, new_text, new_decision_id, new_action_id,
       old_decision_id, old_action_id, resolution, status, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END)`,
  );
  const oldNotionPage = db.prepare(
    "SELECT notion_page_id AS pageId, notion_url AS url FROM action_items WHERE id = ? AND notion_page_id IS NOT NULL",
  );
  const inheritNotionPage = db.prepare(
    "UPDATE action_items SET notion_page_id = ?, notion_url = ?, notion_status = 'needs_update' WHERE id = ?",
  );
  const decisionExists = db.prepare("SELECT 1 FROM decisions WHERE id = ?");
  const taskExists = db.prepare("SELECT 1 FROM action_items WHERE id = ?");

  const run = db.transaction(() => {
    const personIds = new Map<string, number>(); // lower-cased name -> id
    const personId = (raw: string): number | null => {
      const name = normalizeName(raw);
      if (!name) return null;
      const key = name.toLowerCase();
      const cached = personIds.get(key);
      if (cached) return cached;
      insertPerson.run(name);
      const { id } = findPerson.get(name) as { id: number };
      personIds.set(key, id);
      return id;
    };

    const meetingId = Number(
      insertMeeting.run(
        input.title,
        input.meetingDate,
        input.source,
        input.rawTranscript,
        input.cleanTranscript || null,
        input.summary || null,
      ).lastInsertRowid,
    );

    // Everyone mentioned + every owner counts as part of this meeting (drives the digest).
    for (const name of [...input.people, ...input.actionItems.map((a) => a.owner)]) {
      const id = personId(name);
      if (id) insertAttendee.run(meetingId, id);
    }

    const decisionIds = new Map<string, number>(); // draft key -> new row id
    for (const d of input.decisions) {
      decisionIds.set(d.key, Number(insertDecision.run(meetingId, d.text, d.reason || null, d.topic || null).lastInsertRowid));
    }

    const actionIds = new Map<string, number>();
    for (const a of input.actionItems) {
      const info = insertAction.run(
        meetingId,
        a.task,
        a.sourceQuote ? `From the meeting: "${a.sourceQuote}"` : null,
        personId(a.owner),
        a.dueDate || null,
      );
      actionIds.set(a.key, Number(info.lastInsertRowid));
    }

    let replaced = 0;
    let discussLater = 0;
    for (const c of input.conflicts) {
      const oldExists = (c.oldKind === "decision" ? decisionExists : taskExists).get(c.oldId);
      if (!oldExists) continue;
      const newDecisionId = c.newKind === "decision" ? (decisionIds.get(c.newKey) ?? null) : null;
      const newActionId = c.newKind === "action" ? (actionIds.get(c.newKey) ?? null) : null;
      // The new item was deleted from the draft (and not because of "keep old"): nothing to record.
      if (c.resolution !== "keep_old" && newDecisionId === null && newActionId === null) continue;

      if (c.resolution === "replace_old") {
        // The old task is already in Notion: the new one takes over that page (updated on approval,
        // never duplicated).
        if (c.oldKind === "task" && newActionId !== null) {
          const page = oldNotionPage.get(c.oldId) as { pageId: string; url: string | null } | undefined;
          if (page) inheritNotionPage.run(page.pageId, page.url, newActionId);
        }
        const changed =
          c.oldKind === "decision"
            ? supersedeDecision.run(newDecisionId, meetingId, c.oldId).changes
            : dropTask.run(meetingId, c.oldId).changes;
        replaced += changed;
      }
      const status = c.resolution === "discuss_later" ? "open" : "resolved";
      if (status === "open") discussLater++;
      insertConflict.run(
        meetingId,
        c.type,
        c.explanation,
        c.newText,
        newDecisionId,
        newActionId,
        c.oldKind === "decision" ? c.oldId : null,
        c.oldKind === "task" ? c.oldId : null,
        c.resolution,
        status,
        status,
      );
    }

    return {
      meetingId,
      counts: {
        decisions: input.decisions.length,
        actionItems: input.actionItems.length,
        people: personIds.size,
        replaced,
        discussLater,
      },
    };
  });

  return run();
}
