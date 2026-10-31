"use client";

import { useState, useSyncExternalStore } from "react";
import { IconCheck, IconCopy, IconDigest, IconRefresh } from "@/components/icons";
import { primaryButton, secondaryButton } from "@/components/page-header";
import type { FriendlyError } from "@/lib/meeting-types";
import { generateDigestAction } from "./actions";

function timeOf(createdAt: string): string {
  // created_at is UTC "YYYY-MM-DD HH:MM:SS"
  const d = new Date(`${createdAt.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const noopSubscribe = () => () => {};

export function DigestCard({ name, initial }: { name: string; initial: { content: string; createdAt: string } | null }) {
  // The time is formatted in the viewer's locale, so only render it in the browser (no hydration mismatch).
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [digest, setDigest] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate(regenerate = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await generateDigestAction(name, regenerate);
      if (res.ok) setDigest({ content: res.content, createdAt: res.createdAt });
      else setError(res.error);
    } catch {
      setError({ kind: "api", title: "Can't reach the app", message: "Check that the app is still running, then try again.", retryable: true });
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!digest) return;
    try {
      await navigator.clipboard.writeText(digest.content);
    } catch {
      // Clipboard API blocked: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = digest.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section aria-label={`Digest for ${name}`} className="glass min-w-0 rounded-[28px] p-6 md:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{name}&apos;s week</h2>
          <p className="text-[13px] text-ink-3">
            {digest
              ? `Written today${mounted && timeOf(digest.createdAt) ? ` at ${timeOf(digest.createdAt)}` : ""}. Saved, so reopening it is free.`
              : "One AI call, then saved for the rest of the day."}
          </p>
        </div>
        {digest && !loading && (
          <div className="flex gap-2">
            <button type="button" onClick={() => generate(true)} className={`${secondaryButton} h-10 px-4 text-[14px]`} title="Write it again with the latest data (one AI call)">
              <IconRefresh size={16} />
              Regenerate
            </button>
            <button type="button" onClick={copy} className={`${primaryButton} h-10 px-4 text-[14px]`}>
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div aria-busy aria-live="polite" className="space-y-3 rounded-[20px] bg-sheet p-5 shadow-control">
          <p className="text-[14px] font-medium text-ink-2">Writing {name}&apos;s digest…</p>
          {[0.9, 0.75, 0.82, 0.6, 0.7].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded-full bg-fill" style={{ width: `${w * 100}%` }} />
          ))}
        </div>
      ) : digest ? (
        <pre className="whitespace-pre-wrap rounded-[20px] bg-sheet p-5 font-sans text-[15px] leading-[1.65] text-ink shadow-control">{digest.content}</pre>
      ) : (
        <div className="flex flex-col items-center rounded-[20px] bg-sheet px-6 py-10 text-center shadow-control">
          <span className="mb-4 grid size-12 place-items-center rounded-full bg-fill text-ink-2">
            <IconDigest size={22} />
          </span>
          <p className="text-[17px] font-medium">No digest for {name} yet today</p>
          <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-ink-2">
            Get a short, friendly summary of their open and overdue tasks, what they finished, decisions that affect them and items to discuss.
          </p>
          <button type="button" onClick={() => generate()} className={`${primaryButton} mt-5`}>
            Generate digest
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-[18px] bg-caution-soft px-4 py-3 ring-1 ring-caution/40">
          <p className="text-[15px] font-semibold">{error.title}</p>
          <p className="mt-0.5 text-[14px] text-ink-2">{error.message}</p>
          {error.retryable && (
            <button type="button" onClick={() => generate(Boolean(digest))} className={`${secondaryButton} mt-3 h-9 px-4 text-[14px]`}>
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
