import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { IconTasks } from "@/components/icons";
import { EmptyState, PageHeader, primaryButton } from "@/components/page-header";
import { addDaysIso, todayIso } from "@/lib/dates";
import {
  DUE_FILTERS,
  UNASSIGNED,
  allPeopleNames,
  listTasks,
  notionPendingTaskIds,
  taskCounts,
  taskOwners,
  unassignedOpenCount,
  type DueFilter,
  type Task,
  type TaskStatusFilter,
} from "@/lib/queries";
import { TASK_COLUMNS } from "./columns";
import { SendAllButton } from "./send-all-button";
import { TaskItem } from "./task-item";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage({ searchParams }: PageProps<"/tasks">) {
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every action item from every meeting. Tick them off, fill in missing owners or deadlines, and send them to Notion."
      />
      <Suspense fallback={<BoardSkeleton />}>
        <TaskBoard searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const DUE_LABELS: Record<DueFilter, string> = {
  any: "Any date",
  overdue: "Overdue",
  soon: "Next 48 hours",
  week: "This week",
  later: "Later",
  none: "No deadline",
};

async function TaskBoard({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await connection();

  const status: TaskStatusFilter = (["open", "done", "all"] as const).find((s) => s === one(sp.status)) ?? "open";
  const due: DueFilter = DUE_FILTERS.find((d) => d === one(sp.due)) ?? "any";
  const owner = one(sp.owner)?.trim() || undefined;
  const today = todayIso();

  const counts = taskCounts(owner);
  const tasks = listTasks({ status, owner, due, today });
  const owners = taskOwners();
  const unassigned = unassignedOpenCount();
  const people = allPeopleNames();
  const pendingNotion = notionPendingTaskIds().length;

  if (counts.all === 0 && !owner) {
    return (
      <EmptyState
        icon={<IconTasks size={22} />}
        title="No tasks yet"
        action={
          <Link href="/meetings/new" className={primaryButton}>
            Capture a meeting
          </Link>
        }
      >
        Save a meeting and its action items land here, ready to tick off and send to Notion.
      </EmptyState>
    );
  }

  const href = (next: { status?: TaskStatusFilter; owner?: string | null; due?: DueFilter }) => {
    const q = new URLSearchParams();
    const s = next.status ?? status;
    const o = next.owner === undefined ? owner : next.owner;
    const d = next.due ?? due;
    if (s !== "open") q.set("status", s);
    if (d !== "any") q.set("due", d);
    if (o) q.set("owner", o);
    const qs = q.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };
  const filtered = due !== "any" || owner;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="glass-flat space-y-4 rounded-[24px] p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <FilterGroup label="Status">
            <nav aria-label="Task status" className="flex rounded-full bg-fill p-1">
              {(["open", "done", "all"] as const).map((s) => (
                <Link
                  key={s}
                  href={href({ status: s })}
                  aria-current={status === s ? "page" : undefined}
                  className={[
                    "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors duration-150",
                    status === s ? "bg-sheet font-medium text-ink shadow-control" : "text-ink-2 hover:text-ink",
                  ].join(" ")}
                >
                  {s === "open" ? "Open" : s === "done" ? "Done" : "All"}
                  <span className="tabular-nums text-ink-3">{counts[s]}</span>
                </Link>
              ))}
            </nav>
          </FilterGroup>
          <FilterGroup label="Due">
            <nav aria-label="Due date" className="flex flex-wrap gap-1.5">
              {DUE_FILTERS.map((d) => (
                <Chip key={d} href={href({ due: d })} active={due === d} tone={d === "overdue" ? "live" : undefined}>
                  {DUE_LABELS[d]}
                </Chip>
              ))}
            </nav>
          </FilterGroup>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterGroup label="Person">
          <nav aria-label="Filter by person" className="flex flex-wrap items-center gap-1.5">
            <Chip href={href({ owner: null })} active={!owner}>
              Everyone
            </Chip>
            {owners.map((o) => (
              <Chip key={o.name} href={href({ owner: o.name })} active={owner?.toLowerCase() === o.name.toLowerCase()} avatar={o.name} count={o.open}>
                {o.name}
              </Chip>
            ))}
            {unassigned > 0 && (
              <Chip href={href({ owner: UNASSIGNED })} active={owner === UNASSIGNED} avatar="" count={unassigned}>
                No owner
              </Chip>
            )}
          </nav>
        </FilterGroup>
        <SendAllButton count={pendingNotion} />
        </div>
      </div>

      <datalist id="task-people">
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<IconTasks size={22} />}
          title={status === "done" ? "Nothing ticked off yet" : "Nothing matches these filters"}
          action={
            filtered ? (
              <Link href={href({ owner: null, due: "any" })} className={primaryButton}>
                Clear filters
              </Link>
            ) : undefined
          }
        >
          {status === "done" ? "Completed tasks show up here." : "Try another person or due date."}
        </EmptyState>
      ) : (
        <div className="sheet overflow-hidden rounded-[24px]">
          <div className={`hidden gap-x-4 border-b border-hairline px-5 py-2.5 text-[13px] text-ink-3 md:grid ${TASK_COLUMNS}`} aria-hidden>
            <span />
            <span>Task</span>
            <span>Owner</span>
            <span>Due</span>
            <span>Notion</span>
          </div>
          {groupByDue(tasks, today, status).map((g) => (
            <section key={g.title} aria-label={g.title}>
              {g.title && (
                <h2
                  className={`flex items-center gap-2 border-b border-hairline bg-fill/60 px-5 py-2 text-[13px] font-semibold ${g.title === "Overdue" ? "text-live" : "text-ink-2"}`}
                >
                  {g.title} <span className="font-normal tabular-nums text-ink-3">{g.tasks.length}</span>
                </h2>
              )}
              <ul className="divide-y divide-hairline border-b border-hairline last:border-b-0">
                {g.tasks.map((t) => (
                  <TaskItem key={`${t.id}-${t.status}-${t.owner}-${t.dueDate}-${t.notionStatus}`} task={t} today={today} peopleListId="task-people" />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByDue(tasks: Task[], today: string, status: TaskStatusFilter): { title: string; tasks: Task[] }[] {
  if (status === "done") return [{ title: "", tasks }];
  const soon = addDaysIso(today, 2);
  const week = addDaysIso(today, 7);
  const groups: Record<string, Task[]> = { Overdue: [], "Next 48 hours": [], "This week": [], Later: [], "No deadline": [], Done: [] };
  for (const t of tasks) {
    if (t.status === "done") groups.Done.push(t);
    else if (!t.dueDate) groups["No deadline"].push(t);
    else if (t.dueDate < today) groups.Overdue.push(t);
    else if (t.dueDate <= soon) groups["Next 48 hours"].push(t);
    else if (t.dueDate <= week) groups["This week"].push(t);
    else groups.Later.push(t);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([title, list]) => ({ title, tasks: list }));
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-14 text-[13px] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
  avatar,
  count,
  tone,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  avatar?: string;
  count?: number;
  tone?: "live";
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex h-9 items-center gap-2 rounded-full pr-3.5 text-[14px] transition-colors duration-150",
        avatar !== undefined ? "pl-1" : "pl-3.5",
        active
          ? tone === "live"
            ? "bg-live font-medium text-white shadow-control"
            : "bg-sheet font-medium text-ink shadow-control"
          : tone === "live"
            ? "bg-live-soft text-live hover:bg-live-soft/80"
            : "bg-fill text-ink-2 hover:bg-fill-hover hover:text-ink",
      ].join(" ")}
    >
      {avatar !== undefined && <Avatar name={avatar} size={28} />}
      {children}
      {count !== undefined && count > 0 && <span className={`tabular-nums ${active && tone === "live" ? "text-white/80" : "text-ink-3"}`}>{count}</span>}
    </Link>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="glass-flat h-[124px] rounded-[24px] opacity-70" />
      <div className="sheet divide-y divide-hairline overflow-hidden rounded-[24px] opacity-70">
        {[0.55, 0.4, 0.62, 0.48].map((w, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-5">
            <span className="size-6 rounded-full bg-fill" />
            <div className="flex-1 space-y-2.5">
              <div className="h-3.5 rounded-full bg-fill" style={{ width: `${w * 100}%` }} />
              <div className="h-3 w-40 rounded-full bg-fill" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
