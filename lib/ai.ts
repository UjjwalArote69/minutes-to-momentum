import "server-only";
import crypto from "node:crypto";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getDb } from "./db";

/**
 * THE ONLY PLACE THAT TALKS TO GEMINI. Every AI feature goes through generateJson().
 *
 * - Asks Gemini for JSON that matches a Zod schema (structured output) and validates it.
 * - Every request has a time limit, so an overloaded model can't hang the UI.
 * - If the main model is busy (429 / 500 / 502 / 503 / 504 / time limit) it walks a CHAIN of fallback
 *   models (GEMINI_FALLBACK_MODEL, comma-separated) and stops at the first that answers. Busy models
 *   usually reject in 1-2 s, so the chain is fast. With no fallbacks it retries the same model once
 *   after Gemini's suggested wait.
 * - Caches validated responses in SQLite (ai_cache table) keyed by model + prompt +
 *   schema, so re-running the same transcript costs zero free-tier quota.
 */

const DEFAULT_MODEL = "gemini-3.5-flash";
/** Tried in order when the main model is busy. Availability shifts between models, so keep several. */
const DEFAULT_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
const PRIMARY_TIMEOUT_MS = 20_000;
const FALLBACK_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 60_000; // longer suggested waits usually mean the daily quota is gone
const DEFAULT_RETRY_WAIT_MS = 10_000;

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "rate_limit" | "busy" | "api" | "invalid_json",
    readonly raw?: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function getModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/** Fallback models in order (GEMINI_FALLBACK_MODEL, comma-separated; "none" disables). */
export function getFallbackModels(): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODEL?.trim();
  if (raw && /^(none|off|false)$/i.test(raw)) return [];
  const list = raw ? raw.split(",").map((m) => m.trim()).filter(Boolean) : DEFAULT_FALLBACK_MODELS;
  const main = getModelName();
  return [...new Set(list)].filter((m) => m !== main);
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiError(
      "GEMINI_API_KEY is missing. Add it to .env.local and restart `npm run dev`.",
      "config",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export interface GenerateJsonOptions<T extends z.ZodType> {
  /** The user-facing task, e.g. the transcript plus instructions. */
  prompt: string;
  /** Zod schema the response must match. Also sent to Gemini as the response schema. */
  schema: T;
  /** System instruction (role, rules, today's date, etc.). */
  system?: string;
  /** Short name for logs and the cache table, e.g. "extract" or "conflicts". */
  label?: string;
  /** Defaults to 0.2 for consistent extractions. */
  temperature?: number;
  /** Set false to skip the cache entirely (no read, no write). Default true. */
  cache?: boolean;
  /** Set true to ignore a cached answer and overwrite it with a fresh one. */
  refresh?: boolean;
}

export async function generateJson<T extends z.ZodType>(
  opts: GenerateJsonOptions<T>,
): Promise<z.infer<T>> {
  const {
    prompt,
    schema,
    system,
    label = "ai",
    temperature = 0.2,
    cache = true,
    refresh = false,
  } = opts;

  const model = getModelName();
  const jsonSchema = toGeminiSchema(schema);
  // Keyed by the MAIN model, so an answer from the fallback is reused for the same prompt.
  const key = sha256(JSON.stringify({ model, system, prompt, jsonSchema, temperature }));

  // 1) Cache hit -> no API call.
  if (cache && !refresh) {
    const row = getDb()
      .prepare("SELECT response FROM ai_cache WHERE key = ?")
      .get(key) as { response: string } | undefined;
    if (row) {
      const parsed = schema.safeParse(JSON.parse(row.response));
      if (parsed.success) {
        console.log(`[ai:${label}] cache hit`);
        return parsed.data;
      }
      // Schema changed since this was cached; fall through and refetch.
    }
  }

  // 2) Call Gemini (main model, then one retry).
  const call = (m: string, timeoutMs: number) =>
    getClient().models.generateContent({
      model: m,
      contents: prompt,
      config: {
        ...(system ? { systemInstruction: system } : {}),
        temperature,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        httpOptions: { timeout: timeoutMs },
      },
    });
  const { text, usedModel } = await callWithFallbacks(label, model, call);

  // 3) Parse + validate.
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(text));
  } catch {
    throw new AiError(`Gemini returned text that is not valid JSON (${label}).`, "invalid_json", text);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AiError(
      `Gemini JSON did not match the expected shape (${label}): ${z.prettifyError(parsed.error)}`,
      "invalid_json",
      text,
    );
  }

  // 4) Save validated answer for next time.
  if (cache) {
    getDb()
      .prepare(
        `INSERT INTO ai_cache (key, model, label, response) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET model = excluded.model, response = excluded.response, created_at = datetime('now')`,
      )
      .run(key, usedModel, label, JSON.stringify(parsed.data));
  }

  return parsed.data;
}

/** Delete cached AI answers (all, or only one label). Returns rows removed. */
export function clearAiCache(label?: string): number {
  const db = getDb();
  const info = label
    ? db.prepare("DELETE FROM ai_cache WHERE label = ?").run(label)
    : db.prepare("DELETE FROM ai_cache").run();
  return info.changes;
}

// ---------------------------------------------------------------------------

type Call = (model: string, timeoutMs: number) => Promise<{ text?: string }>;

async function callWithFallbacks(
  label: string,
  model: string,
  call: Call,
): Promise<{ text: string; usedModel: string }> {
  const started = Date.now();
  try {
    const text = requireText(await call(model, PRIMARY_TIMEOUT_MS), label);
    console.log(`[ai:${label}] ${model} answered in ${seconds(started)}`);
    return { text, usedModel: model };
  } catch (err) {
    if (!isRetryable(err)) throw toAiError(err);

    const fallbacks = getFallbackModels();
    if (fallbacks.length > 0) {
      // A busy model usually stays busy for a while, so switch models instead of waiting.
      console.warn(`[ai:${label}] ${model} ${describe(err)} after ${seconds(started)}; trying ${fallbacks.join(" > ")}`);
      let lastErr: unknown = err;
      for (const fallback of fallbacks) {
        const retryStarted = Date.now();
        try {
          const text = requireText(await call(fallback, FALLBACK_TIMEOUT_MS), label);
          console.log(`[ai:${label}] ${fallback} answered in ${seconds(retryStarted)}`);
          return { text, usedModel: fallback };
        } catch (err2) {
          lastErr = err2;
          if (!isRetryable(err2)) throw toAiError(err2); // e.g. bad request: another model won't help
          console.warn(`[ai:${label}] ${fallback} ${describe(err2)} after ${seconds(retryStarted)}`);
        }
      }
      throw toAiError(lastErr);
    }

    const waitMs = suggestedRetryMs(err);
    if (waitMs > MAX_RETRY_WAIT_MS) {
      throw new AiError(
        `Gemini rate limit hit and it asks to wait ${Math.round(waitMs / 1000)}s. ` +
          "The free daily quota is probably used up; try again later or switch GEMINI_MODEL.",
        "rate_limit",
      );
    }
    console.warn(`[ai:${label}] ${model} ${describe(err)}, retrying once in ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      return { text: requireText(await call(model, FALLBACK_TIMEOUT_MS), label), usedModel: model };
    } catch (err2) {
      throw toAiError(err2);
    }
  }
}

function requireText(res: { text?: string }, label: string): string {
  const text = res.text;
  if (!text) throw new AiError(`Gemini returned an empty response (${label}).`, "api");
  return text;
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error) || err instanceof ApiError) return false;
  return err.name === "AbortError" || err.name === "TimeoutError" || /abort|timed? ?out/i.test(err.message);
}

/** Rate limits and Google-side overload / gateway errors are temporary: worth one retry. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  return (err instanceof ApiError && RETRYABLE_STATUS.has(err.status)) || isTimeout(err);
}

function describe(err: unknown): string {
  if (isTimeout(err)) return "timed out";
  if (err instanceof ApiError) return err.status === 429 ? "rate limited" : `is busy (${err.status})`;
  return "failed";
}

function seconds(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(1)}s`;
}

/** Gemini 429 bodies include e.g. "retryDelay": "23s" or "Please retry in 23.4s". */
function suggestedRetryMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m =
    msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : DEFAULT_RETRY_WAIT_MS;
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (isTimeout(err)) {
    return new AiError("Gemini took too long to answer (the model is probably overloaded).", "busy");
  }
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return new AiError("Gemini rate limit hit again after one retry. Wait a minute and try again.", "rate_limit");
    }
    if (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504) {
      return new AiError(`Gemini is overloaded right now (${err.status}): ${err.message}`, "busy");
    }
    if (err.status === 404) {
      // Google's 404 often names a replacement, e.g. "...please use models/gemini-3.8-flash".
      const suggested = err.message.match(/use models\/([\w.-]+)/i)?.[1];
      return new AiError(
        `Gemini model "${getModelName()}" isn't available to this API key. ` +
          `Set GEMINI_MODEL in .env.local to ${suggested ? `"${suggested}" (Google's suggestion) or ` : ""}a Flash model listed in Google AI Studio.`,
        "config",
      );
    }
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      return new AiError(`Gemini rejected the request (${err.status}): ${err.message}`, "config");
    }
    return new AiError(`Gemini API error (${err.status}): ${err.message}`, "api");
  }
  return new AiError(err instanceof Error ? err.message : String(err), "api");
}

function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  // Gemini rejects the "$schema" meta key, so drop it.
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function stripCodeFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
