"use client";

import { useState, useTransition } from "react";
import { secondaryButton } from "@/components/page-header";
import { resetDemoDataAction, settleConflictAction } from "./dashboard-actions";

/** Two-step button: it asks before wiping everything and loading the demo meetings. */
export function ResetDemoButton() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setMessage(null);
    startTransition(async () => {
      const res = await resetDemoDataAction();
      setConfirming(false);
      setMessage(res.ok ? "Demo data loaded" : res.message);
    });
  }

  if (confirming) {
    return (
      <div role="group" aria-label="Confirm reset" className="glass-strong flex flex-wrap items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5">
        <span className="text-[14px] text-ink-2">Replace all meetings with the demo data?</span>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="h-9 rounded-full bg-live px-4 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Resetting" : "Reset"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="h-9 rounded-full px-3.5 text-[14px] font-medium text-ink-2 hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span role="status" className="text-[14px] text-ink-2">
          {message}
        </span>
      )}
      <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
        Reset demo data
      </button>
    </div>
  );
}

export function SettleButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => void (await settleConflictAction(id)))}
      className="h-8 shrink-0 rounded-full bg-sheet px-3.5 text-[13px] font-medium text-ink shadow-control transition-opacity hover:opacity-85 disabled:opacity-50"
    >
      {pending ? "Saving" : "Mark settled"}
    </button>
  );
}
