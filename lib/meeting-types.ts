// Shared between the client (review UI) and the server (actions). No server-only imports here.
import { z } from "zod";

export const MAX_TRANSCRIPT_CHARS = 40_000;
export const MIN_TRANSCRIPT_CHARS = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-31). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isoDate = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD).");

// --- The editable draft shown on the review screen ---------------------------

export interface DraftDecision {
  id: string;
  text: string;
  reason: string;
  topic: string;
}

export interface DraftActionItem {
  id: string;
  task: string;
  /** Empty string = needs clarification. */
  owner: string;
  /** YYYY-MM-DD, or empty string = needs clarification. */
  dueDate: string;
  /** The deadline words as spoken, e.g. "next Friday" (for the user to double-check). */
  deadlineSaid: string;
  sourceQuote: string;
  /** Question the AI suggests asking when owner/deadline is unclear. */
  question: string;
}

export interface MeetingDraft {
  summary: string;
  cleanTranscript: string;
  people: string[];
  decisions: DraftDecision[];
  actionItems: DraftActionItem[];
}

// --- Conflicts with memory ---------------------------------------------------

export const CONFLICT_TYPES = [
  "contradicting_decision",
  "changed_deadline",
  "reassigned_owner",
  "duplicate_task",
  "scope_violation",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const CONFLICT_RESOLUTIONS = ["replace_old", "keep_old", "discuss_later"] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/** The earlier item a new one clashes with. Everything here comes from the database, not the AI. */
export interface PastItem {
  kind: "decision" | "task";
  id: number;
  text: string;
  owner: string | null;
  dueDate: string | null;
  meetingTitle: string;
  meetingDate: string;
}

export interface DraftConflict {
  id: string;
  type: ConflictType;
  /** One simple sentence from the AI about what changed. */
  explanation: string;
  /** The new item in the current draft. */
  newItem: { kind: "decision" | "action"; id: string };
  old: PastItem;
  resolution: ConflictResolution | null;
}

export function needsOwner(item: Pick<DraftActionItem, "owner">): boolean {
  return item.owner.trim() === "";
}
export function needsDeadline(item: Pick<DraftActionItem, "dueDate">): boolean {
  return !isIsoDate(item.dueDate);
}

// --- Server action inputs / results ------------------------------------------

export const processMeetingInputSchema = z.object({
  title: z.string().trim().max(200),
  meetingDate: isoDate,
  transcript: z
    .string()
    .trim()
    .min(MIN_TRANSCRIPT_CHARS, "Add a bit more of the meeting first (at least a sentence or two).")
    .max(MAX_TRANSCRIPT_CHARS, `That's a long one! Keep it under ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters.`),
  fresh: z.boolean().optional(),
});
export type ProcessMeetingInput = z.input<typeof processMeetingInputSchema>;

const personName = z.string().trim().min(1).max(100);

const draftKey = z.string().min(1).max(64);

export const saveMeetingInputSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a title.").max(200),
  meetingDate: isoDate,
  source: z.enum(["voice", "paste"]),
  rawTranscript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
  cleanTranscript: z.string().max(MAX_TRANSCRIPT_CHARS * 2),
  summary: z.string().trim().max(5_000),
  people: z.array(personName).max(200),
  decisions: z
    .array(
      z.object({
        key: draftKey,
        text: z.string().trim().min(1).max(1_000),
        reason: z.string().trim().max(1_000),
        topic: z.string().trim().max(100),
      }),
    )
    .max(200),
  actionItems: z
    .array(
      z.object({
        key: draftKey,
        task: z.string().trim().min(1).max(1_000),
        owner: z.string().trim().max(100),
        dueDate: z.union([z.literal(""), isoDate]),
        sourceQuote: z.string().trim().max(2_000),
      }),
    )
    .max(200),
  /** Every conflict must have a choice before saving. */
  conflicts: z
    .array(
      z.object({
        type: z.enum(CONFLICT_TYPES),
        explanation: z.string().trim().min(1).max(500),
        newKind: z.enum(["decision", "action"]),
        newKey: draftKey,
        newText: z.string().trim().min(1).max(1_000),
        oldKind: z.enum(["decision", "task"]),
        oldId: z.number().int().positive(),
        resolution: z.enum(CONFLICT_RESOLUTIONS, { error: "Choose what to do with every conflict before saving." }),
      }),
    )
    .max(100),
});
export type SaveMeetingInput = z.input<typeof saveMeetingInputSchema>;

/** A message that is safe and friendly to show in the UI. */
export interface FriendlyError {
  kind: "input" | "rate_limit" | "quota" | "busy" | "config" | "invalid_json" | "api" | "db";
  title: string;
  message: string;
  /** Show a "Try again" button. */
  retryable: boolean;
}

export type ProcessMeetingResult =
  | {
      ok: true;
      draft: MeetingDraft;
      conflicts: DraftConflict[];
      /** Set when extraction worked but the memory check didn't (the user can retry it). */
      conflictError: FriendlyError | null;
    }
  | { ok: false; error: FriendlyError };

// --- Approval + Notion ----------------------------------------------------------

export interface ApprovalTask {
  id: number;
  title: string;
  owner: string | null;
  dueDate: string | null;
  quote: string | null;
  status: string;
  approved: boolean;
  notionStatus: "sending" | "sent" | "failed" | "needs_update" | null;
  notionUrl: string | null;
  notionError: string | null;
}

export type SyncOutcome =
  | { id: number; ok: true; action: "created" | "updated" | "skipped"; url: string }
  | { id: number; ok: false; kind: string; message: string };

export type ApproveTasksResult = { results: SyncOutcome[]; tasks: ApprovalTask[]; databaseUrl: string | null };

export type SaveMeetingResult =
  | {
      ok: true;
      meetingId: number;
      /** The meeting's action items, ready for the Approve tasks step. */
      tasks: ApprovalTask[];
      counts: { decisions: number; actionItems: number; people: number; replaced: number; discussLater: number };
    }
  | { ok: false; error: FriendlyError };

export type CheckConflictsResult = { ok: true; conflicts: DraftConflict[] } | { ok: false; error: FriendlyError };
