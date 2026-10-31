"use server";

import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { generateDigest } from "@/lib/digest";
import { friendlyAiError } from "@/lib/friendly-errors";
import type { FriendlyError } from "@/lib/meeting-types";

export type DigestResult = { ok: true; content: string; createdAt: string; fromCache: boolean } | { ok: false; error: FriendlyError };

/** Returns today's saved digest for the person, or writes it with one AI call. */
export async function generateDigestAction(name: string, regenerate = false): Promise<DigestResult> {
  const parsed = z.object({ name: z.string().trim().min(1).max(100), regenerate: z.boolean() }).safeParse({ name, regenerate });
  if (!parsed.success) {
    return { ok: false, error: { kind: "input", title: "Pick a person first", message: "Choose who the digest is for.", retryable: false } };
  }
  try {
    const d = await generateDigest(parsed.data.name, todayIso(), { regenerate: parsed.data.regenerate });
    return { ok: true, ...d };
  } catch (err) {
    console.error("[digest]", err);
    return { ok: false, error: friendlyAiError(err) };
  }
}
