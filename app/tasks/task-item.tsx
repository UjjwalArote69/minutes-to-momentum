"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { pillField, pillFieldMissing } from "@/components/fields";
import { NotionBadge } from "@/components/notion-badge";
import { dueLabel, formatDayMonth } from "@/lib/dates";
import type { Task } from "@/lib/queries";
import { sendTaskToNotionAction, setTaskDoneAction, updateTaskDetailsAction, type TaskActionResult } from "./actions";
import { TASK_COLUMNS } from "./columns";


const toneClass = {
  overdue: "text-live font-medium",
  today: "text-ink font-medium",
  soon: "text-ink-2",
  later: "text-ink-3",
} as const;

export function TaskItem({ task, today, peopleListId }: { task: Task; today: string; peopleListId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [owner, setOwner] = useState(task.owner ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  // Optimistic tick so the circle fills the moment you press it.
  const [doneOverride, setDoneOverride] = useState<boolean | null>(null);
  const done = doneOverride ?? task.status === "done";

  const missingOwner = !owner.trim();
  const missingDate = !dueDate;
  const unclear = !done && (missingOwner || missingDate);
  const due = dueDate ? dueLabel(dueDate, today) : null;
  const overdue = !done && due?.tone === "overdue";

  function run(action: () => Promise<TaskActionResult>, onFail?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setMessage({ tone: "error", text: res.message });
        onFail?.();
      } else if (res.warning) {
        setMessage({ tone: "warning", text: res.warning });
      }
    });
  }

  function toggleDone() {
    const next = !done;
    setDoneOverride(next);
    run(() => setTaskDoneAction(task.id, next), () => setDoneOverride(null));
  }

  function saveDetails(nextOwner: string, nextDue: string) {
    if (nextOwner.trim() === (task.owner ?? "") && nextDue === (task.dueDate ?? "")) return;
    run(() => updateTaskDetailsAction(task.id, { owner: nextOwner, dueDate: nextDue }));
  }

  return (
    <li
      className={[
        "grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-5 py-4 transition-[background-color,opacity] duration-200 md:items-center",
        TASK_COLUMNS,
        unclear ? "bg-attention-soft" : "",
        overdue ? "bg-live-soft/60 shadow-[inset_3px_0_0_var(--live)]" : "",
        pending ? "opacity-70" : "",
      ].join(" ")}
    >
      {/* Done */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onClick={toggleDone}
        disabled={pending}
        className={[
          "grid size-6 place-items-center rounded-full border-[1.5px] transition-colors duration-150 max-md:mt-0.5",
          done ? "border-go bg-go text-white" : overdue ? "border-live/70 hover:border-live" : "border-ink-3/60 hover:border-ink-2",
        ].join(" ")}
      >
        {done && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 4.5 4.5L19 7" />
          </svg>
        )}
      </button>

      {/* Task */}
      <div className="min-w-0">
        <p className={`text-[15px] leading-snug ${done ? "text-ink-3 line-through decoration-ink-3/60" : "font-medium"}`}>{task.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink-3">
          {task.meetingTitle}, {formatDayMonth(task.meetingDate)}
        </p>
        {message && (
          <p role="alert" className={`mt-1 text-[13px] font-medium ${message.tone === "error" ? "text-live" : "text-caution-ink"}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* Owner */}
      <div className="col-start-2 flex min-w-0 items-center gap-2 md:col-start-auto">
        <Avatar name={owner} size={26} />
        {done ? (
          <span className="truncate text-[14px] text-ink-3">{task.owner ?? "No owner"}</span>
        ) : (
          <>
            <label htmlFor={`task-${task.id}-owner`} className="sr-only">
              Owner of {task.title}
            </label>
            <input
              id={`task-${task.id}-owner`}
              list={peopleListId}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={() => saveDetails(owner, dueDate)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="Who owns this?"
              className={`${missingOwner ? pillFieldMissing : pillField} w-full min-w-0`}
            />
          </>
        )}
      </div>

      {/* Due */}
      <div className="col-start-2 min-w-0 md:col-start-auto">
        {done ? (
          <span className="text-[14px] text-ink-3">{task.dueDate ? formatDayMonth(task.dueDate) : "No deadline"}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label htmlFor={`task-${task.id}-due`} className="sr-only">
              Deadline for {task.title}
            </label>
            <input
              id={`task-${task.id}-due`}
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                saveDetails(owner, e.target.value);
              }}
              className={`${missingDate ? pillFieldMissing : overdue ? `${pillField} text-live` : pillField} w-full max-w-[150px]`}
            />
            <span className={`text-[12px] ${due ? toneClass[due.tone] : "font-medium text-attention-ink"}`}>
              {due ? due.text : "Needs a deadline"}
            </span>
          </div>
        )}
      </div>

      {/* Notion */}
      <div className="col-start-2 md:col-start-auto">
        <NotionState task={task} done={done} blocked={missingOwner || missingDate} pending={pending} onSend={() => run(() => sendTaskToNotionAction(task.id))} />
      </div>
    </li>
  );
}

const smallButton =
  "h-8 rounded-full bg-sheet px-3.5 text-[13px] font-medium text-ink shadow-control transition-opacity hover:opacity-85 disabled:opacity-40";

/** Where this task stands with Notion, and the one action that makes sense next. */
function NotionState({
  task,
  done,
  blocked,
  pending,
  onSend,
}: {
  task: Task;
  done: boolean;
  blocked: boolean;
  pending: boolean;
  onSend: () => void;
}) {
  if (task.notionStatus === "sent") return <NotionBadge url={task.notionUrl} />;
  if (task.notionStatus === "needs_update") {
    return (
      <button type="button" onClick={onSend} disabled={pending || blocked} className={smallButton} title={task.notionError ?? "The Notion page is out of date"}>
        {pending ? "Updating" : "Update in Notion"}
      </button>
    );
  }
  if (task.notionStatus === "failed") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSend} disabled={pending || blocked} className={smallButton}>
          {pending ? "Sending" : "Retry"}
        </button>
        <span className="text-[12px] font-medium text-live" title={task.notionError ?? undefined}>
          Couldn&apos;t send
        </span>
      </span>
    );
  }
  if (done) return <span className="text-[13px] text-ink-3">Not in Notion</span>;
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={pending || blocked}
      title={blocked ? "Add an owner and a deadline first" : task.approved ? "Send this task to Notion" : "Approve this task and send it to Notion"}
      className={smallButton}
    >
      {pending ? "Sending" : task.approved ? "Send to Notion" : "Approve and send"}
    </button>
  );
}
