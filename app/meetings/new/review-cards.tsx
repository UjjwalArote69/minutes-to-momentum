"use client";

import { useState } from "react";
import {
  needsDeadline,
  needsOwner,
  type DraftActionItem,
  type DraftDecision,
} from "@/lib/meeting-types";
import { Avatar } from "@/components/avatar";
import { inlineField, pillField, pillFieldMissing } from "@/components/fields";

// --- Small shared pieces ------------------------------------------------------

export { Avatar };

export function IconButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-fill-hover hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ClarifyBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-attention-soft px-3 text-[13px] font-medium text-attention-ink ring-1 ring-attention/60">
      <span className="size-1.5 rounded-full bg-attention" aria-hidden />
      {children}
    </span>
  );
}

export function SectionTitle({
  title,
  count,
  badge,
  action,
}: {
  title: string;
  count?: number;
  badge?: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h3 className="text-[22px] font-semibold tracking-[-0.02em]">
        {title}
        {count !== undefined && <span className="ml-2 font-normal text-ink-3 tabular-nums">{count}</span>}
      </h3>
      {badge}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-blue transition-colors duration-150 hover:bg-fill"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {action.label}
        </button>
      )}
    </div>
  );
}

// --- Summary ------------------------------------------------------------------

export function SummaryPanel({
  summary,
  cleanTranscript,
  onChange,
}: {
  summary: string;
  cleanTranscript: string;
  onChange: (summary: string) => void;
}) {
  return (
    <section className="glass rounded-[28px] p-6 md:p-8">
      <h3 className="mb-3 text-[15px] font-medium text-ink-2">Summary</h3>
      <textarea
        aria-label="Meeting summary"
        value={summary}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="A few sentences on what the meeting settled"
        className={`${inlineField} field-sizing-content resize-none text-[19px] leading-[1.55] tracking-[-0.01em]`}
      />
      {cleanTranscript && (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1.5 rounded-full text-[14px] font-medium text-blue">
            <svg className="transition-transform duration-200 group-open:rotate-90" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
            Cleaned-up transcript
          </summary>
          <p className="mt-3 max-w-[72ch] whitespace-pre-wrap rounded-[18px] bg-fill p-4 text-[14px] leading-relaxed text-ink-2">
            {cleanTranscript}
          </p>
        </details>
      )}
    </section>
  );
}

// --- People -------------------------------------------------------------------

export function PeopleRow({ people, onChange }: { people: string[]; onChange: (people: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function commit() {
    const name = newName.replace(/\s+/g, " ").trim();
    if (name && !people.some((p) => p.toLowerCase() === name.toLowerCase())) onChange([...people, name]);
    setNewName("");
    setAdding(false);
  }

  return (
    <section>
      <SectionTitle title="People" count={people.length} />
      <ul className="flex flex-wrap gap-x-5 gap-y-4">
        <li className="flex w-16 flex-col items-center gap-2">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
              className="contents"
            >
              <input
                autoFocus
                aria-label="Name of the person to add"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => e.key === "Escape" && (setNewName(""), setAdding(false))}
                placeholder="Name"
                className="size-14 rounded-full bg-sheet text-center text-[13px] shadow-control focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-blue/40"
              />
              <span className="text-[13px] text-ink-3">Enter to add</span>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setAdding(true)}
                aria-label="Add a person"
                className="grid size-14 place-items-center rounded-full bg-sheet text-ink shadow-control transition-transform duration-150 active:scale-95"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <span className="text-[13px] text-ink-2">Add</span>
            </>
          )}
        </li>
        {people.map((p) => (
          <li key={p} className="group relative flex w-16 flex-col items-center gap-2">
            <Avatar name={p} size={56} />
            <span className="w-full truncate text-center text-[13px] text-ink-2" title={p}>
              {p}
            </span>
            <button
              type="button"
              aria-label={`Remove ${p}`}
              onClick={() => onChange(people.filter((x) => x !== p))}
              className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-sheet text-ink-2 opacity-0 shadow-control transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <CloseIcon size={11} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Decisions ----------------------------------------------------------------

export interface ItemFlag {
  tone: "excluded" | "conflict";
  text: string;
}

/** Note on an item that takes part in a conflict with memory. */
function FlagNote({ flag }: { flag: ItemFlag }) {
  return (
    <p
      className={`inline-flex items-center gap-2 text-[13px] font-medium ${flag.tone === "conflict" ? "text-caution-ink" : "text-ink-3"}`}
    >
      <span className={`size-1.5 rounded-full ${flag.tone === "conflict" ? "bg-caution" : "bg-ink-3"}`} aria-hidden />
      {flag.text}
    </p>
  );
}

export function DecisionTile({
  decision,
  flag,
  onChange,
  onRemove,
}: {
  decision: DraftDecision;
  flag?: ItemFlag;
  onChange: (patch: Partial<DraftDecision>) => void;
  onRemove: () => void;
}) {
  return (
    <article
      className={[
        "glass-flat flex flex-col gap-3 rounded-[24px] p-5 transition-opacity duration-200",
        flag?.tone === "excluded" ? "opacity-55" : "",
        flag?.tone === "conflict" ? "ring-2 ring-caution/50" : "",
      ].join(" ")}
    >
      {flag && <FlagNote flag={flag} />}
      <div className="flex items-start gap-2">
        <textarea
          aria-label="Decision"
          value={decision.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={2}
          placeholder="What was decided"
          className={`${inlineField} field-sizing-content flex-1 resize-none text-[17px] font-semibold leading-snug tracking-[-0.01em]`}
        />
        <IconButton label="Remove this decision" onClick={onRemove}>
          <CloseIcon />
        </IconButton>
      </div>
      <label className="flex items-baseline gap-2 text-[14px]">
        <span className="shrink-0 text-ink-3">Because</span>
        <input
          aria-label="Reason"
          value={decision.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          placeholder="no reason was given"
          className={`${inlineField} text-ink-2`}
        />
      </label>
      <div className="mt-auto">
        <input
          aria-label="Topic"
          value={decision.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
          placeholder="Add a topic"
          size={Math.max(decision.topic.length, 10)}
          className={`${pillField} h-7 text-[13px] text-ink-2`}
        />
      </div>
    </article>
  );
}

// --- Action items -------------------------------------------------------------

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function ActionRow({
  item,
  flag,
  peopleListId,
  onChange,
  onRemove,
}: {
  item: DraftActionItem;
  flag?: ItemFlag;
  peopleListId: string;
  onChange: (patch: Partial<DraftActionItem>) => void;
  onRemove: () => void;
}) {
  const id = `action-${item.id}`;
  const missingOwner = needsOwner(item);
  const missingDeadline = needsDeadline(item);
  const excluded = flag?.tone === "excluded";
  const unclear = !excluded && (missingOwner || missingDeadline);

  return (
    <li
      className={[
        "flex gap-4 px-5 py-5 transition-[background-color,opacity] duration-200 md:px-6",
        unclear ? "bg-attention-soft" : "",
        excluded ? "opacity-55" : "",
        flag?.tone === "conflict" ? "shadow-[inset_3px_0_0_var(--caution)]" : "",
      ].join(" ")}
    >
      <Avatar name={item.owner} size={40} />

      <div className="min-w-0 flex-1">
        {flag && (
          <div className="mb-1.5">
            <FlagNote flag={flag} />
          </div>
        )}
        <textarea
          aria-label="Task"
          value={item.task}
          onChange={(e) => onChange({ task: e.target.value })}
          rows={1}
          placeholder="What needs to be done"
          className={`${inlineField} field-sizing-content resize-none text-[16px] font-medium leading-snug`}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-owner`} className="sr-only">
            Owner
          </label>
          <input
            id={`${id}-owner`}
            list={peopleListId}
            value={item.owner}
            onChange={(e) => onChange({ owner: e.target.value })}
            placeholder="Who owns this?"
            size={Math.max(item.owner.length + 2, 13)}
            className={missingOwner ? pillFieldMissing : pillField}
          />
          <label htmlFor={`${id}-due`} className="sr-only">
            Deadline
          </label>
          <input
            id={`${id}-due`}
            type="date"
            value={item.dueDate}
            onChange={(e) => onChange({ dueDate: e.target.value })}
            className={missingDeadline ? pillFieldMissing : pillField}
          />
          <span className="text-[13px] text-ink-3">
            {missingDeadline
              ? item.deadlineSaid
                ? `They said “${item.deadlineSaid}”`
                : "No deadline was said"
              : item.deadlineSaid
                ? `${formatDay(item.dueDate)}, from “${item.deadlineSaid}”`
                : formatDay(item.dueDate)}
          </span>
        </div>

        {unclear && item.question && (
          <p className="mt-3 text-[14px] font-medium text-attention-ink">{item.question}</p>
        )}

        <div className="mt-3 flex gap-2 text-[13px] leading-relaxed text-ink-3">
          <span aria-hidden className="my-1.5 w-0.5 shrink-0 self-stretch rounded-full bg-ink-3/30" />
          <label htmlFor={`${id}-quote`} className="sr-only">
            What was said in the meeting
          </label>
          <textarea
            id={`${id}-quote`}
            value={item.sourceQuote}
            onChange={(e) => onChange({ sourceQuote: e.target.value })}
            rows={1}
            placeholder="What was said in the meeting"
            className={`${inlineField} field-sizing-content resize-none`}
          />
        </div>
      </div>

      <IconButton label="Remove this action item" onClick={onRemove} className="-mr-1 -mt-1">
        <CloseIcon />
      </IconButton>
    </li>
  );
}
