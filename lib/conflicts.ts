import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { generateJson } from "./ai";
import { getDb } from "./db";
import { formatShort } from "./dates";
import { CONFLICT_TYPES, type ConflictType, type DraftConflict, type PastItem } from "./meeting-types";

/**
 * Memory check: ONE Gemini call compares a new meeting's decisions and action items with
 * every active decision and open task already saved. The AI only links item IDs and writes
 * the explanation; the "original meeting / date / owner" shown to the user comes from the DB.
 */

const MAX_PAST_ITEMS = 80;

const conflictSchema = z.object({
  conflicts: z.array(
    z.object({
      type: z.enum(CONFLICT_TYPES),
      new_item: z.string().describe("ID of the NEW item, e.g. D1 or A2."),
      past_item: z.string().describe("ID of the PAST item it clashes with, e.g. PD4 or PT7."),
      explanation: z
        .string()
        .describe("One short, plain sentence saying what changed, e.g. 'The launch moves from Nov 30 to Dec 15.'"),
    }),
  ),
});

const SYSTEM = `You compare what a team decided in a NEW meeting with what they decided and assigned in PAST meetings, and report real conflicts only.

CONFLICT TYPES
- contradicting_decision: a new decision contradicts or reverses a past decision on the same subject (different date, price, choice, or cancels it).
- changed_deadline: a new action item is the same work as a past open task but with a different deadline.
- reassigned_owner: a new action item is the same work as a past open task but with a different owner. If both the owner and the deadline changed, use reassigned_owner and mention both in the explanation.
- duplicate_task: a new action item is the same work as a past open task with the same owner and deadline, or with no owner/deadline given. A new task with no owner is never reassigned_owner.
- scope_violation: a past decision freezes the scope (e.g. "no new features"), and a new decision or action item adds a new feature or scope.

RULES
- Only report a conflict when you are confident. Different subjects are never conflicts. Repeating a past decision unchanged is not a conflict.
- At most one conflict per pair of items. One new item may conflict with several past items.
- Use only the IDs given (D#, A# for new items; PD#, PT# for past items).
- explanation: one short, plain sentence about what changed, with the old and the new value when there is one (e.g. "Pricing page moves from Rahul (due Nov 7) to Neha (due Nov 14)."). No IDs in the sentence.
- If there are no conflicts, return an empty list.`;

interface PastDecisionRow {
  id: number;
  text: string;
  owner: string | null;
  meetingTitle: string;
  meetingDate: string;
}
interface PastTaskRow {
  id: number;
  title: string;
  owner: string | null;
  dueDate: string | null;
  meetingTitle: string;
  meetingDate: string;
}

function loadPast() {
  const db = getDb();
  const decisions = db
    .prepare(
      `SELECT d.id, d.text, p.name AS owner, m.title AS meetingTitle, m.meeting_date AS meetingDate
       FROM decisions d JOIN meetings m ON m.id = d.meeting_id LEFT JOIN people p ON p.id = d.owner_id
       WHERE d.status IN ('active', 'proposed') ORDER BY m.meeting_date DESC, d.id DESC LIMIT ?`,
    )
    .all(MAX_PAST_ITEMS) as PastDecisionRow[];
  const tasks = db
    .prepare(
      `SELECT a.id, a.title, p.name AS owner, a.due_date AS dueDate, m.title AS meetingTitle, m.meeting_date AS meetingDate
       FROM action_items a JOIN meetings m ON m.id = a.meeting_id LEFT JOIN people p ON p.id = a.owner_id
       WHERE a.status IN ('proposed', 'confirmed') ORDER BY m.meeting_date DESC, a.id DESC LIMIT ?`,
    )
    .all(MAX_PAST_ITEMS) as PastTaskRow[];
  return { decisions, tasks };
}

/** What changed between an open task and a new task for the same work. */
function taskChange(action: { owner: string; dueDate: string }, old: PastItem): ConflictType {
  const newOwner = action.owner.trim().toLowerCase();
  const ownerChanged = newOwner !== "" && newOwner !== (old.owner ?? "").toLowerCase();
  const deadlineChanged = action.dueDate !== "" && action.dueDate !== (old.dueDate ?? "");
  if (ownerChanged) return "reassigned_owner";
  if (deadlineChanged) return "changed_deadline";
  return "duplicate_task";
}

export interface NewItems {
  title: string;
  meetingDate: string;
  decisions: { id: string; text: string }[];
  actionItems: { id: string; task: string; owner: string; dueDate: string }[];
}

export async function findConflicts(items: NewItems, opts: { fresh?: boolean } = {}): Promise<DraftConflict[]> {
  const decisions = items.decisions.filter((d) => d.text.trim());
  const actions = items.actionItems.filter((a) => a.task.trim());
  if (decisions.length === 0 && actions.length === 0) return [];

  const past = loadPast();
  if (past.decisions.length === 0 && past.tasks.length === 0) return []; // nothing in memory yet: no AI call

  // Short IDs for the prompt -> real items.
  const newById = new Map<string, { kind: "decision" | "action"; id: string }>();
  decisions.forEach((d, i) => newById.set(`D${i + 1}`, { kind: "decision", id: d.id }));
  actions.forEach((a, i) => newById.set(`A${i + 1}`, { kind: "action", id: a.id }));
  const pastById = new Map<string, PastItem>();
  for (const d of past.decisions) {
    pastById.set(`PD${d.id}`, { kind: "decision", id: d.id, text: d.text, owner: d.owner, dueDate: null, meetingTitle: d.meetingTitle, meetingDate: d.meetingDate });
  }
  for (const t of past.tasks) {
    pastById.set(`PT${t.id}`, { kind: "task", id: t.id, text: t.title, owner: t.owner, dueDate: t.dueDate, meetingTitle: t.meetingTitle, meetingDate: t.meetingDate });
  }

  const line = (s: string) => s.replace(/\s+/g, " ").trim();
  const prompt = `NEW MEETING: "${line(items.title) || "Untitled"}" on ${items.meetingDate}

NEW DECISIONS
${decisions.map((d, i) => `D${i + 1}: ${line(d.text)}`).join("\n") || "(none)"}

NEW ACTION ITEMS
${actions.map((a, i) => `A${i + 1}: ${line(a.task)} | owner: ${a.owner.trim() || "not set"} | due: ${a.dueDate || "not set"}`).join("\n") || "(none)"}

PAST ACTIVE DECISIONS
${past.decisions.map((d) => `PD${d.id}: ${line(d.text)} | owner: ${d.owner ?? "not set"} | from "${d.meetingTitle}" on ${d.meetingDate}`).join("\n") || "(none)"}

PAST OPEN TASKS
${past.tasks.map((t) => `PT${t.id}: ${line(t.title)} | owner: ${t.owner ?? "not set"} | due: ${t.dueDate ?? "not set"} | from "${t.meetingTitle}" on ${t.meetingDate}`).join("\n") || "(none)"}`;

  const result = await generateJson({ label: "conflicts", system: SYSTEM, prompt, schema: conflictSchema, refresh: opts.fresh });

  const actionById = new Map(actions.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const conflicts: DraftConflict[] = [];
  for (const c of result.conflicts) {
    const newItem = newById.get(c.new_item.trim().toUpperCase());
    const old = pastById.get(c.past_item.trim().toUpperCase());
    if (!newItem || !old) continue; // hallucinated or malformed reference
    const key = `${newItem.id}|${old.kind}${old.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let type: ConflictType = c.type;
    let explanation = c.explanation.trim();
    // Task vs task: the AI decides that they are the same work; the kind of change is decided
    // from the real owner/deadline, so the label can't contradict the data.
    const action = newItem.kind === "action" ? actionById.get(newItem.id) : undefined;
    if (action && old.kind === "task" && (type === "reassigned_owner" || type === "changed_deadline" || type === "duplicate_task")) {
      const computed = taskChange(action, old);
      if (computed !== type) {
        type = computed;
        if (computed === "duplicate_task") {
          const who = [old.owner, old.dueDate && `due ${formatShort(old.dueDate)}`].filter(Boolean).join(", ");
          explanation = `This repeats "${old.text}", which is already open${who ? ` (${who})` : ""}.`;
        }
      }
    }
    conflicts.push({ id: crypto.randomUUID(), type, explanation, newItem, old, resolution: null });
  }
  return conflicts;
}
