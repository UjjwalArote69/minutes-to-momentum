"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/meeting-types";
import { approveAndSend, syncDoneStatus } from "@/lib/notion-sync";
import { setTaskDone, updateTaskDetails } from "@/lib/queries";

export type TaskActionResult = { ok: true; warning?: string } | { ok: false; message: string };

const taskId = z.number().int().positive();

export async function setTaskDoneAction(id: number, done: boolean): Promise<TaskActionResult> {
  const parsed = z.object({ id: taskId, done: z.boolean() }).safeParse({ id, done });
  if (!parsed.success) return { ok: false, message: "That task couldn't be found." };
  try {
    if (!setTaskDone(parsed.data.id, parsed.data.done)) return { ok: false, message: "That task couldn't be found." };
  } catch (err) {
    console.error("[setTaskDone]", err);
    return { ok: false, message: "Couldn't update the task. Try again." };
  }
  // Mirror to Notion (Status: Done / To Do) when the task is already there.
  const notion = await syncDoneStatus(parsed.data.id);
  refresh();
  return notion.ok ? { ok: true } : { ok: true, warning: `Saved here, but Notion wasn't updated: ${notion.message}` };
}

/** Approve one task and send it to Notion (or update / retry it). */
export async function sendTaskToNotionAction(id: number): Promise<TaskActionResult> {
  const parsed = taskId.safeParse(id);
  if (!parsed.success) return { ok: false, message: "That task couldn't be found." };
  const { results } = await approveAndSend([parsed.data]);
  refresh();
  const r = results[0];
  return r?.ok ? { ok: true } : { ok: false, message: r?.message ?? "Couldn't send the task to Notion." };
}

const detailsSchema = z.object({
  id: taskId,
  owner: z.string().trim().max(100),
  dueDate: z.union([z.literal(""), z.string().refine(isIsoDate)]),
});

export async function updateTaskDetailsAction(
  id: number,
  details: { owner: string; dueDate: string },
): Promise<TaskActionResult> {
  const parsed = detailsSchema.safeParse({ id, ...details });
  if (!parsed.success) return { ok: false, message: "Use a name and a valid date." };
  try {
    if (!updateTaskDetails(parsed.data.id, parsed.data)) return { ok: false, message: "That task couldn't be found." };
  } catch (err) {
    console.error("[updateTaskDetails]", err);
    return { ok: false, message: "Couldn't save the change. Try again." };
  }
  refresh();
  return { ok: true };
}
