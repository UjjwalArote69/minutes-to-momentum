"use client";

import { useState, useTransition } from "react";
import { primaryButton } from "@/components/page-header";
import { sendAllToNotionAction, type SendAllResult } from "./actions";

/** "Send N tasks to Notion": approves and sends every ready task that isn't in Notion yet. */
export function SendAllButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SendAllResult | null>(null);

  function send() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await sendAllToNotionAction());
      } catch {
        setResult({ sent: 0, updated: 0, failed: count, firstError: "Couldn't reach the app. Check that it's still running.", databaseUrl: null });
      }
    });
  }

  const done = result && result.sent + result.updated > 0;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {result && (
        <p role="status" className={`text-[14px] ${result.failed ? "text-live" : "text-ink-2"}`}>
          {done && `${result.sent + result.updated} sent to Notion${result.updated ? ` (${result.updated} updated, not duplicated)` : ""}. `}
          {result.failed > 0 && `${result.failed} couldn't be sent: ${result.firstError ?? "try again"}`}
          {!done && !result.failed && "Everything ready is already in Notion."}
        </p>
      )}
      {done && result.databaseUrl && (
        <a href={result.databaseUrl} target="_blank" rel="noreferrer" className="h-10 rounded-full bg-fill px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-fill-hover">
          Open Notion
        </a>
      )}
      {count > 0 && (
        <button
          type="button"
          onClick={send}
          disabled={pending}
          title="Approves and sends every task that has an owner and a deadline but isn't in Notion yet. Tasks already in Notion are never duplicated."
          className={`${primaryButton} h-10 px-5 text-[14px]`}
        >
          {pending ? "Sending" : `Send ${count} ${count === 1 ? "task" : "tasks"} to Notion`}
        </button>
      )}
    </div>
  );
}
