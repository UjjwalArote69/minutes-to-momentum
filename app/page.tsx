import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { IconAlert, IconCalendar, IconChat, IconCheck, IconClock, IconMic } from "@/components/icons";
import { EmptyState, PageHeader, linkButton, primaryButton } from "@/components/page-header";
import { dueLabel, formatDayMonth, formatLong, todayIso } from "@/lib/dates";
import { dashboardStats, openConflicts, recentMeetings, reminders, type Task } from "@/lib/queries";
import { ResetDemoButton, SettleButton } from "./dashboard-buttons";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Today"
        description={
          <Suspense fallback={<span className="opacity-0">Today</span>}>
            <TodayLine />
          </Suspense>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ResetDemoButton />
            <Link href="/meetings/new" className={primaryButton}>
              <IconMic size={17} />
              New meeting
            </Link>
          </div>
        }
      />

      <Suspense fallback={<StatsSkeleton />}>
        <Stats />
      </Suspense>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Panel id="reminders" title="Reminders" action={<Link href="/tasks" className={linkButton}>All tasks</Link>}>
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <Reminders />
          </Suspense>
        </Panel>
        <Panel id="discuss" title="Items to discuss" action={<Link href="/decisions" className={linkButton}>Decisions</Link>}>
          <Suspense fallback={<ListSkeleton rows={2} />}>
            <Discuss />
          </Suspense>
        </Panel>
      </div>

      <Panel title="Recent meetings" className="mt-5" action={<Link href="/meetings/new" className={linkButton}>New meeting</Link>}>
        <Suspense fallback={<ListSkeleton rows={2} />}>
          <Recent />
        </Suspense>
      </Panel>
    </>
  );
}

// --- Pieces ---------------------------------------------------------------------

async function TodayLine() {
  await connection();
  return <>{formatLong(todayIso())}. Here&apos;s what needs you today.</>;
}

function Panel({
  id,
  title,
  action,
  className = "",
  children,
}: {
  id?: string;
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className={`glass-flat min-w-0 scroll-mt-24 rounded-[28px] p-5 md:p-6 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

async function Stats() {
  await connection();
  const s = dashboardStats(todayIso());
  const cards = [
    { label: "Meetings", value: s.meetings, note: "remembered so far", href: "/decisions", tone: "" },
    { label: "Open tasks", value: s.open, note: `${s.dueSoon} due in the next 48 hours`, href: "/tasks", tone: "" },
    { label: "Overdue", value: s.overdue, note: s.overdue ? "past their deadline" : "nothing late", href: "/tasks?due=overdue", tone: s.overdue ? "text-live" : "" },
    { label: "Unresolved conflicts", value: s.conflicts, note: s.conflicts ? "waiting to be discussed" : "all settled", href: "/#discuss", tone: s.conflicts ? "text-caution-ink" : "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="glass-flat group rounded-[24px] p-5 transition-[background-color,transform] duration-150 hover:bg-[var(--glass-strong)] active:scale-[0.99]"
        >
          <p className="text-[14px] text-ink-2">{c.label}</p>
          <p className={`mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${c.tone}`}>{c.value}</p>
          <p className="mt-2 text-[13px] text-ink-3">{c.note}</p>
        </Link>
      ))}
    </div>
  );
}

async function Reminders() {
  await connection();
  const today = todayIso();
  const tasks = reminders(today);
  if (tasks.length === 0) {
    return (
      <EmptyState flat icon={<IconCheck size={22} />} title="You're all caught up">
        Nothing is overdue and nothing is due in the next 48 hours.
      </EmptyState>
    );
  }
  const overdue = tasks.filter((t) => t.dueDate! < today);
  const soon = tasks.filter((t) => t.dueDate! >= today);
  return (
    <div className="space-y-4">
      {overdue.length > 0 && <ReminderGroup title="Overdue" tone="overdue" tasks={overdue} today={today} />}
      {soon.length > 0 && <ReminderGroup title="Due in the next 48 hours" tasks={soon} today={today} />}
    </div>
  );
}

function ReminderGroup({ title, tasks, today, tone }: { title: string; tasks: Task[]; today: string; tone?: "overdue" }) {
  return (
    <div>
      <h3 className={`mb-1.5 flex items-center gap-2 text-[14px] font-medium ${tone ? "text-live" : "text-ink-2"}`}>
        {tone ? <IconAlert size={15} /> : <IconClock size={15} />}
        {title} <span className="tabular-nums text-ink-3">{tasks.length}</span>
      </h3>
      <ul className="divide-y divide-hairline overflow-hidden rounded-[18px] bg-sheet shadow-control">
        {tasks.map((t) => {
          const due = dueLabel(t.dueDate!, today);
          return (
            <li key={t.id} className={`flex items-center gap-3 px-4 py-3 ${tone ? "shadow-[inset_3px_0_0_var(--live)]" : ""}`}>
              <Avatar name={t.owner} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{t.title}</p>
                <p className="truncate text-[13px] text-ink-3">
                  {t.owner ?? "No owner yet"}, from {t.meetingTitle}
                </p>
              </div>
              <span className={`shrink-0 text-[13px] ${due.tone === "overdue" ? "font-medium text-live" : due.tone === "today" ? "font-medium" : "text-ink-2"}`}>
                {due.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function Discuss() {
  await connection();
  const items = openConflicts();
  if (items.length === 0) {
    return (
      <EmptyState flat icon={<IconChat size={21} />} title="Nothing waiting">
        When a new meeting clashes with an earlier decision and you choose Discuss later, it shows up here.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="rounded-[18px] bg-caution-soft p-4 ring-1 ring-caution/40">
          <p className="text-[15px] font-medium leading-snug">{c.explanation}</p>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {c.oldMeetingTitle && c.oldMeetingDate
              ? `${c.oldMeetingTitle} (${formatDayMonth(c.oldMeetingDate)}) vs ${c.meetingTitle} (${formatDayMonth(c.meetingDate)})`
              : `Raised in ${c.meetingTitle} (${formatDayMonth(c.meetingDate)})`}
          </p>
          <div className="mt-3 flex justify-end">
            <SettleButton id={c.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

async function Recent() {
  await connection();
  const meetings = recentMeetings(5);
  if (meetings.length === 0) {
    return (
      <EmptyState
        flat
        icon={<IconCalendar size={21} />}
        title="No meetings yet"
        action={
          <Link href="/meetings/new" className={primaryButton}>
            Capture your first meeting
          </Link>
        }
      >
        Talk through a recap or paste a transcript, or load the demo data with Reset demo data.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-[18px] bg-sheet shadow-control">
      {meetings.map((m) => (
        <li key={m.id}>
          <Link href={`/decisions#meeting-${m.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-fill">
            <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-fill text-center leading-none">
              <span>
                <span className="block text-[16px] font-semibold tabular-nums">{Number(m.date.slice(8, 10))}</span>
                <span className="mt-0.5 block text-[11px] text-ink-3">{formatDayMonth(m.date).split(" ")[1]}</span>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{m.title}</span>
              <span className="block text-[13px] text-ink-3">
                {m.decisions} {m.decisions === 1 ? "decision" : "decisions"}, {m.tasks} {m.tasks === 1 ? "task" : "tasks"}
              </span>
            </span>
            <span className="flex -space-x-2">
              {m.attendees.slice(0, 5).map((a) => (
                <Avatar key={a} name={a} size={28} />
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass-flat h-[118px] rounded-[24px] opacity-70" />
      ))}
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 rounded-[16px] bg-fill opacity-70" />
      ))}
    </div>
  );
}
