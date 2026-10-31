"use client";

import { formatShort } from "@/lib/dates";
import type { ConflictResolution, ConflictType, DraftConflict } from "@/lib/meeting-types";

const TYPE_LABEL: Record<ConflictType, string> = {
  contradicting_decision: "Contradicts an earlier decision",
  scope_violation: "Breaks the scope freeze",
  changed_deadline: "Deadline changed",
  reassigned_owner: "Owner changed",
  duplicate_task: "Duplicate task",
};

/** Red for things that undo a decision; orange for task changes. */
const isSevere = (t: ConflictType) => t === "contradicting_decision" || t === "scope_violation";

const CHOICES: { value: ConflictResolution; label: string; effect: string }[] = [
  { value: "replace_old", label: "Replace old", effect: "The new one wins. The old one is marked replaced and stays in history." },
  { value: "keep_old", label: "Keep old", effect: "The old one stays. The new item won't be saved." },
  { value: "discuss_later", label: "Discuss later", effect: "Both are saved and this stays open on the Today page until someone settles it." },
];

export interface NewSide {
  text: string;
  owner?: string;
  dueDate?: string;
}

function meta(parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(", ");
}

export function ConflictCard({
  conflict,
  newSide,
  onResolve,
}: {
  conflict: DraftConflict;
  newSide: NewSide;
  onResolve: (resolution: ConflictResolution) => void;
}) {
  const severe = isSevere(conflict.type);
  const { old, resolution } = conflict;
  const label =
    conflict.type === "reassigned_owner" && newSide.dueDate && old.dueDate && newSide.dueDate !== old.dueDate
      ? "Owner and deadline changed"
      : TYPE_LABEL[conflict.type];
  const chosen = CHOICES.find((c) => c.value === resolution);

  return (
    <article
      aria-label={label}
      className={[
        "rounded-[28px] p-5 ring-1 transition-[box-shadow,background-color] duration-200 md:p-6",
        severe ? "bg-live-soft ring-live/30" : "bg-caution-soft ring-caution/45",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-2 text-[14px] font-semibold ${severe ? "text-live" : "text-caution-ink"}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 8v5M12 16.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          {label}
        </span>
        {chosen ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-go">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5 12 4.5 4.5L19 7" />
            </svg>
            Decided
          </span>
        ) : (
          <span className="text-[13px] font-medium text-ink-2">Needs a choice</span>
        )}
      </div>

      <p className="mt-2 text-[18px] font-semibold leading-snug tracking-[-0.01em]">{conflict.explanation}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Side
          heading={`Before, in ${old.meetingTitle}`}
          text={old.text}
          detail={meta([
            formatShort(old.meetingDate),
            old.owner && `owner ${old.owner}`,
            old.dueDate && `due ${formatShort(old.dueDate)}`,
          ])}
          struck={resolution === "replace_old"}
          note={resolution === "replace_old" ? "Will be marked replaced, kept in history" : resolution === "keep_old" ? "Stays as it is" : null}
        />
        <Side
          heading="Now, in this meeting"
          text={newSide.text || "(empty)"}
          detail={meta([newSide.owner && `owner ${newSide.owner}`, newSide.dueDate && `due ${formatShort(newSide.dueDate)}`]) || null}
          struck={resolution === "keep_old"}
          note={resolution === "keep_old" ? "Won't be saved" : resolution === "replace_old" ? "Will be saved" : null}
          emphasis
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="radiogroup" aria-label="What should happen?" className="flex flex-wrap gap-2">
          {CHOICES.map((c) => {
            const active = resolution === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={c.effect}
                onClick={() => onResolve(c.value)}
                className={[
                  "h-10 rounded-full px-4 text-[14px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]",
                  active ? "bg-primary text-on-primary shadow-control" : "bg-sheet text-ink shadow-control hover:bg-fill-hover",
                ].join(" ")}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">{chosen ? chosen.effect : "Pick one to continue."}</p>
      </div>
    </article>
  );
}

function Side({
  heading,
  text,
  detail,
  struck,
  note,
  emphasis = false,
}: {
  heading: string;
  text: string;
  detail: string | null;
  struck: boolean;
  note: string | null;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-[20px] bg-sheet/80 p-4 shadow-control">
      <p className="text-[13px] text-ink-3">{heading}</p>
      <p className={`mt-1 text-[16px] leading-snug ${emphasis ? "font-medium" : ""} ${struck ? "text-ink-3 line-through decoration-ink-3/60" : ""}`}>
        {text}
      </p>
      {detail && <p className="mt-1.5 text-[13px] text-ink-2">{detail}</p>}
      {note && <p className="mt-2 text-[13px] font-medium text-ink-2">{note}</p>}
    </div>
  );
}
