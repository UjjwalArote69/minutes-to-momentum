"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Avatar } from "@/components/avatar";
import { pillField, pillFieldMissing } from "@/components/fields";
import { primaryButton, secondaryButton } from "@/components/page-header";
import { formatShort } from "@/lib/dates";
import type { ApprovalTask, SaveMeetingResult, SyncOutcome } from "@/lib/meeting-types";
import { NotionBadge } from "@/components/notion-badge";
import { approveTasksAction, updateApprovalTaskAction } from "./actions";

type Saved = Extract<SaveMeetingResult, { ok: true }>;

const needsDetails = (t: ApprovalTask) => !t.owner?.trim() || !t.dueDate;
const isSent = (t: ApprovalTask) => t.notionStatus === "sent";
const canApprove = (t: ApprovalTask) => !needsDetails(t) && !isSent(t);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function ApprovePanel({ saved, onStartOver }: { saved: Saved; onStartOver: () => void }) {
  const [tasks, setTasks] = useState<ApprovalTask[]>(saved.tasks);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<{ created: number; updated: number; failed: number; skipped: number } | null>(null);
  const [databaseUrl, setDatabaseUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const peopleListId = useId();

  const approvable = tasks.filter(canApprove);
  const selectedIds = [...selected].filter((id) => tasks.some((t) => t.id === id && canApprove(t)));
  const busy = sending.size > 0;
  const { decisions, actionItems, people, replaced, discussLater } = saved.counts;

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve(ids: number[]) {
    if (ids.length === 0 || busy) return;
    setSending(new Set(ids));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !ids.includes(Number(k)))));
    try {
      const res = await approveTasksAction(ids);
      const byId = new Map(res.tasks.map((t) => [t.id, t]));
      setTasks((ts) => ts.map((t) => byId.get(t.id) ?? t));
      const failed = res.results.filter((r): r is Extract<SyncOutcome, { ok: false }> => !r.ok);
      setErrors((e) => ({ ...e, ...Object.fromEntries(failed.map((r) => [r.id, r.message])) }));
      setSummary({
        created: res.results.filter((r) => r.ok && r.action === "created").length,
        updated: res.results.filter((r) => r.ok && r.action === "updated").length,
        skipped: res.results.filter((r) => r.ok && r.action === "skipped").length,
        failed: failed.length,
      });
      if (res.databaseUrl) setDatabaseUrl(res.databaseUrl);
      setSelected((s) => new Set([...s].filter((id) => failed.some((f) => f.id === id))));
    } catch {
      setErrors((e) => ({ ...e, ...Object.fromEntries(ids.map((id) => [id, "Couldn't reach the app. Check that it's still running, then press Retry."])) }));
      setSummary({ created: 0, updated: 0, skipped: 0, failed: ids.length });
    } finally {
      setSending(new Set());
    }
  }

  async function saveDetails(id: number, owner: string, dueDate: string) {
    const updated = await updateApprovalTaskAction(id, { owner, dueDate });
    if (updated) setTasks((ts) => ts.map((t) => (t.id === id ? updated : t)));
  }

  const sentTotal = (summary?.created ?? 0) + (summary?.updated ?? 0);

  return (
    <div className="space-y-10">
      {/* Saved */}
      <section className="glass flex flex-wrap items-center gap-5 rounded-[28px] p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-go-soft text-go">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 4.5 4.5L19 7" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Meeting saved</h2>
          <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">
            {plural(decisions, "decision")}, {plural(actionItems, "action item")} and {plural(people, "person", "people")} remembered.
            {replaced > 0 && ` ${plural(replaced, "earlier item")} marked replaced.`}
            {discussLater > 0 && ` ${plural(discussLater, "conflict")} left to discuss on Today.`}
          </p>
        </div>
      </section>

      {tasks.length > 0 && (
        <section aria-label="Approve tasks" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[28px] font-semibold tracking-[-0.022em]">Approve tasks</h2>
              <p className="mt-1 text-[15px] text-ink-2">
                Nothing goes to Notion until you approve it. Tasks without an owner or a deadline need those first.
              </p>
            </div>
          </div>

          {summary && (
            <div
              role="status"
              className={`flex flex-wrap items-center gap-4 rounded-[24px] px-5 py-4 ring-1 ${summary.failed ? "bg-caution-soft ring-caution/40" : "bg-go-soft ring-go/30"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[17px] font-semibold">
                  {sentTotal > 0 ? `${plural(sentTotal, "task")} sent to Notion` : summary.failed ? "Nothing was sent" : "Already in Notion"}
                </p>
                <p className="text-[14px] text-ink-2">
                  {[
                    summary.updated > 0 && `${plural(summary.updated, "existing page")} updated instead of duplicated`,
                    summary.skipped > 0 && `${plural(summary.skipped, "task")} already there, skipped`,
                    summary.failed > 0 && `${plural(summary.failed, "task")} couldn't be sent. They're saved here; press Retry`,
                  ]
                    .filter(Boolean)
                    .join(". ") || "Every approved task is in your Notion database."}
                </p>
              </div>
              {databaseUrl && (
                <a href={databaseUrl} target="_blank" rel="noreferrer" className={primaryButton}>
                  Open Notion database
                </a>
              )}
            </div>
          )}

          <datalist id={peopleListId}>
            {[...new Set(tasks.map((t) => t.owner).filter(Boolean))].map((p) => (
              <option key={p} value={p!} />
            ))}
          </datalist>

          <ul className="sheet divide-y divide-hairline overflow-hidden rounded-[28px]">
            {tasks.map((t) => (
              <ApprovalRow
                key={t.id}
                task={t}
                checked={selected.has(t.id)}
                sending={sending.has(t.id)}
                error={errors[t.id] ?? (t.notionStatus === "failed" ? t.notionError : null)}
                peopleListId={peopleListId}
                onToggle={() => toggle(t.id)}
                onRetry={() => approve([t.id])}
                onSaveDetails={(owner, dueDate) => saveDetails(t.id, owner, dueDate)}
              />
            ))}
          </ul>

          {/* Approve bar */}
          <div className="sticky bottom-4 z-10">
            <div className="glass-strong flex flex-wrap items-center justify-between gap-3 rounded-[28px] py-3 pl-6 pr-3 md:rounded-full">
              <p className="text-[14px] text-ink-2">
                {approvable.length === 0
                  ? tasks.every(isSent)
                    ? "Every task is in Notion."
                    : "Fill in the missing owners and deadlines to approve the rest."
                  : `${selectedIds.length} of ${approvable.length} selected.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => approve(approvable.map((t) => t.id))} disabled={busy || approvable.length === 0} className={secondaryButton}>
                  Approve all{approvable.length > 0 ? ` (${approvable.length})` : ""}
                </button>
                <button type="button" onClick={() => approve(selectedIds)} disabled={busy || selectedIds.length === 0} className={primaryButton}>
                  {busy ? (
                    <>
                      <Spinner /> Sending
                    </>
                  ) : (
                    `Approve selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onStartOver} className={secondaryButton}>
          Capture another meeting
        </button>
        <Link href="/tasks" className={secondaryButton}>
          View tasks
        </Link>
        <Link href="/decisions" className={secondaryButton}>
          Decision history
        </Link>
      </div>
    </div>
  );
}

function ApprovalRow({
  task,
  checked,
  sending,
  error,
  peopleListId,
  onToggle,
  onRetry,
  onSaveDetails,
}: {
  task: ApprovalTask;
  checked: boolean;
  sending: boolean;
  error: string | null;
  peopleListId: string;
  onToggle: () => void;
  onRetry: () => void;
  onSaveDetails: (owner: string, dueDate: string) => void;
}) {
  const [owner, setOwner] = useState(task.owner ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const sent = isSent(task);
  const missingOwner = !owner.trim();
  const missingDate = !dueDate;
  const blocked = missingOwner || missingDate;
  const id = `approve-${task.id}`;

  function commit(nextOwner: string, nextDue: string) {
    if (nextOwner.trim() === (task.owner ?? "") && nextDue === (task.dueDate ?? "")) return;
    onSaveDetails(nextOwner, nextDue);
  }

  return (
    <li className={`flex gap-4 px-5 py-5 transition-colors duration-200 md:px-6 ${blocked && !sent ? "bg-attention-soft" : ""}`}>
      {sent ? (
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-go text-white" aria-label="Sent to Notion">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 4.5 4.5L19 7" />
          </svg>
        </span>
      ) : (
        <input
          type="checkbox"
          checked={checked && !blocked}
          onChange={onToggle}
          disabled={blocked || sending}
          aria-label={blocked ? `${task.title}: add an owner and a deadline first` : `Select "${task.title}" for approval`}
          className="mt-1 size-5 shrink-0 cursor-pointer rounded-md accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium leading-snug">{task.title}</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sent ? (
            <span className="inline-flex items-center gap-2 text-[14px] text-ink-2">
              <Avatar name={task.owner} size={22} />
              {task.owner}, due {task.dueDate ? formatShort(task.dueDate) : "not set"}
            </span>
          ) : (
            <>
              <Avatar name={owner} size={24} />
              <label htmlFor={`${id}-owner`} className="sr-only">
                Owner
              </label>
              <input
                id={`${id}-owner`}
                list={peopleListId}
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                onBlur={() => commit(owner, dueDate)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                placeholder="Who owns this?"
                size={Math.max(owner.length + 2, 13)}
                disabled={sending}
                className={missingOwner ? pillFieldMissing : pillField}
              />
              <label htmlFor={`${id}-due`} className="sr-only">
                Deadline
              </label>
              <input
                id={`${id}-due`}
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  commit(owner, e.target.value);
                }}
                disabled={sending}
                className={missingDate ? pillFieldMissing : pillField}
              />
            </>
          )}
        </div>

        {task.quote && <p className="mt-2 text-[13px] leading-relaxed text-ink-3">&ldquo;{task.quote}&rdquo;</p>}

        <div className="mt-2.5">
          {sending ? (
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <Spinner /> Sending to Notion
            </span>
          ) : sent ? (
            <NotionBadge url={task.notionUrl} />
          ) : error ? (
            <span className="flex flex-wrap items-center gap-3">
              <span role="alert" className="text-[13px] font-medium text-live">
                {error}
              </span>
              <button type="button" onClick={onRetry} disabled={blocked} className="h-8 rounded-full bg-sheet px-3.5 text-[13px] font-medium shadow-control disabled:opacity-40">
                Retry
              </button>
            </span>
          ) : blocked ? (
            <span className="text-[13px] font-medium text-attention-ink">
              Needs {missingOwner && missingDate ? "an owner and a deadline" : missingOwner ? "an owner" : "a deadline"} before it can be approved
            </span>
          ) : task.notionStatus === "needs_update" ? (
            <span className="text-[13px] font-medium text-blue">Already in Notion: approving updates that page instead of making a new one</span>
          ) : (
            <span className="text-[13px] text-ink-3">Not in Notion yet</span>
          )}
        </div>
      </div>
    </li>
  );
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
