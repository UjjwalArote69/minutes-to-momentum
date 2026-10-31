"use server";

import { z } from "zod";
import { findConflicts } from "@/lib/conflicts";
import { friendlyAiError } from "@/lib/friendly-errors";
import { extractMeeting } from "@/lib/extraction";
import { saveMeeting } from "@/lib/meetings";
import { approveAndSend, meetingTasksForApproval, taskForApproval } from "@/lib/notion-sync";
import { updateTaskDetails } from "@/lib/queries";
import {
  processMeetingInputSchema,
  saveMeetingInputSchema,
  isIsoDate,
  type ApprovalTask,
  type ApproveTasksResult,
  type CheckConflictsResult,
  type FriendlyError,
  type ProcessMeetingInput,
  type ProcessMeetingResult,
  type SaveMeetingInput,
  type SaveMeetingResult,
} from "@/lib/meeting-types";

// Actions return { ok, ... } instead of throwing: thrown errors are redacted in
// production, and we want the user to see a friendly, specific message.

export async function processMeetingAction(input: ProcessMeetingInput): Promise<ProcessMeetingResult> {
  const parsed = processMeetingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: inputError(parsed.error) };

  let draft;
  try {
    draft = await extractMeeting(parsed.data);
  } catch (err) {
    console.error("[processMeeting]", err);
    return { ok: false, error: friendlyAiError(err) };
  }

  // Second (and last) AI call: compare with memory. If only this fails, still return the draft.
  try {
    const conflicts = await findConflicts(
      { title: parsed.data.title, meetingDate: parsed.data.meetingDate, decisions: draft.decisions, actionItems: draft.actionItems },
      { fresh: parsed.data.fresh },
    );
    return { ok: true, draft, conflicts, conflictError: null };
  } catch (err) {
    console.error("[processMeeting:conflicts]", err);
    return { ok: true, draft, conflicts: [], conflictError: friendlyAiError(err) };
  }
}

const checkConflictsSchema = z.object({
  title: z.string().trim().max(200),
  meetingDate: z.string().refine(isIsoDate),
  decisions: z.array(z.object({ id: z.string().min(1).max(64), text: z.string().max(1_000) })).max(200),
  actionItems: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        task: z.string().max(1_000),
        owner: z.string().max(100),
        dueDate: z.string().max(10),
      }),
    )
    .max(200),
});

/** Re-run only the memory check (after it failed, or after the user edited items). */
export async function checkConflictsAction(input: z.input<typeof checkConflictsSchema>): Promise<CheckConflictsResult> {
  const parsed = checkConflictsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: inputError(parsed.error) };
  try {
    return { ok: true, conflicts: await findConflicts(parsed.data) };
  } catch (err) {
    console.error("[checkConflicts]", err);
    return { ok: false, error: friendlyAiError(err) };
  }
}

export async function saveMeetingAction(input: SaveMeetingInput): Promise<SaveMeetingResult> {
  const parsed = saveMeetingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: inputError(parsed.error) };

  try {
    const saved = saveMeeting(parsed.data);
    return { ok: true, ...saved, tasks: meetingTasksForApproval(saved.meetingId) };
  } catch (err) {
    console.error("[saveMeeting]", err);
    return {
      ok: false,
      error: {
        kind: "db",
        title: "Couldn't save the meeting",
        message: "Something went wrong writing to the local database. Your edits are still on screen, so try Save again.",
        retryable: true,
      },
    };
  }
}

// --- Approve tasks -> Notion -------------------------------------------------------

const idList = z.array(z.number().int().positive()).min(1).max(100);

/** Approve the given tasks and send them to Notion (skips anything already sent). */
export async function approveTasksAction(ids: number[]): Promise<ApproveTasksResult> {
  const parsed = idList.safeParse(ids);
  if (!parsed.success) return { results: [], tasks: [], databaseUrl: null };
  const { results, databaseUrl } = await approveAndSend(parsed.data);
  const tasks = parsed.data.map((id) => taskForApproval(id)).filter((t): t is ApprovalTask => t !== null);
  return { results, tasks, databaseUrl };
}

const detailsSchema = z.object({
  id: z.number().int().positive(),
  owner: z.string().trim().max(100),
  dueDate: z.union([z.literal(""), z.string().refine(isIsoDate)]),
});

/** Fill in a missing owner/deadline on the Approve step (no page refresh). */
export async function updateApprovalTaskAction(
  id: number,
  details: { owner: string; dueDate: string },
): Promise<ApprovalTask | null> {
  const parsed = detailsSchema.safeParse({ id, ...details });
  if (!parsed.success) return null;
  updateTaskDetails(parsed.data.id, parsed.data);
  return taskForApproval(parsed.data.id);
}

function inputError(error: z.ZodError): FriendlyError {
  const first = error.issues[0];
  return {
    kind: "input",
    title: "Something needs a quick fix",
    message: first?.message ?? "Please check the form and try again.",
    retryable: false,
  };
}

