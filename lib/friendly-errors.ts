import "server-only";
import { AiError } from "./ai";
import type { FriendlyError } from "./meeting-types";

/** Turns any AI failure into a message that is safe and friendly to show in the UI. */
export function friendlyAiError(err: unknown): FriendlyError {
  if (!(err instanceof AiError)) {
    return {
      kind: "api",
      title: "The AI step failed",
      message: "Something unexpected went wrong. Your text is safe; try Process again in a moment.",
      retryable: true,
    };
  }
  switch (err.kind) {
    case "rate_limit":
      // lib/ai.ts says "daily quota" when Gemini asks us to wait more than a minute.
      if (/quota/i.test(err.message)) {
        return {
          kind: "quota",
          title: "Today's free AI quota looks used up",
          message:
            "Gemini's free tier asked us to wait a long time, which usually means the daily limit is reached. Try again later, or switch GEMINI_MODEL in .env.local to another Flash model. Your text is safe.",
          retryable: true,
        };
      }
      return {
        kind: "rate_limit",
        title: "Gemini needs a short breather",
        message:
          "We hit the free tier's per-minute limit (we already waited and retried once). Give it about a minute, then press Process again. Your text is safe.",
        retryable: true,
      };
    case "busy":
      return {
        kind: "busy",
        title: "Gemini is overloaded right now",
        message:
          "Google's AI servers are busy at the moment (this isn't your connection). We already tried a backup model. Wait a few seconds and press Process again. Your text is safe.",
        retryable: true,
      };
    case "config":
      return { kind: "config", title: "The AI isn't set up correctly", message: err.message, retryable: false };
    case "invalid_json":
      return {
        kind: "invalid_json",
        title: "The AI's answer came back garbled",
        message: "This happens now and then. Press Process again; it usually works on the second try.",
        retryable: true,
      };
    default:
      return {
        kind: "api",
        title: "Couldn't reach Gemini",
        message: "Check your internet connection and try again. Your text is safe.",
        retryable: true,
      };
  }
}
