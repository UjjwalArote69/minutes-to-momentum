"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { resetDemoData } from "@/lib/demo";
import { settleConflict } from "@/lib/queries";

export type SimpleResult = { ok: true } | { ok: false; message: string };

/** Wipes meetings, people, decisions, tasks and conflicts, then loads the two demo meetings. */
export async function resetDemoDataAction(): Promise<SimpleResult> {
  try {
    resetDemoData();
  } catch (err) {
    console.error("[resetDemoData]", err);
    return { ok: false, message: "Couldn't reset the demo data. Try again." };
  }
  refresh();
  return { ok: true };
}

export async function settleConflictAction(id: number): Promise<SimpleResult> {
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success || !settleConflict(parsed.data)) return { ok: false, message: "That conflict is already settled." };
  refresh();
  return { ok: true };
}
