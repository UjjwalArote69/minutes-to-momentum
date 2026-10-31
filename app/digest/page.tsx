import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { IconUsers } from "@/components/icons";
import { EmptyState, PageHeader, primaryButton } from "@/components/page-header";
import { dueLabel, formatDayMonth, todayIso } from "@/lib/dates";
import { digestFacts, existingDigest } from "@/lib/digest";
import { allPeopleNames, type PersonFacts } from "@/lib/queries";
import { DigestCard } from "./digest-card";

export const metadata: Metadata = { title: "Weekly digest" };

export default function WeeklyDigestPage({ searchParams }: PageProps<"/digest">) {
  return (
    <>
      <PageHeader
        title="Weekly digest"
        description="Pick a teammate and get a short, friendly summary of their week, ready to paste into Slack or email."
      />
      <Suspense fallback={<DigestSkeleton />}>
        <Digest searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Digest({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  await connection();
  const today = todayIso();
  const people = allPeopleNames();

  if (people.length === 0) {
    return (
      <EmptyState
        icon={<IconUsers size={22} />}
        title="No teammates yet"
        action={
          <Link href="/meetings/new" className={primaryButton}>
            Capture a meeting
          </Link>
        }
      >
        People are added automatically when you save a meeting. Or load the demo data from the Today page.
      </EmptyState>
    );
  }

  const asked = typeof sp.person === "string" ? sp.person : undefined;
  const selected = people.find((p) => p.toLowerCase() === asked?.toLowerCase()) ?? null;
  const facts = selected ? digestFacts(selected, today) : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Choose a person" className="glass-flat flex flex-wrap items-center gap-2 rounded-[24px] p-3">
        <span className="px-2 text-[13px] text-ink-3">Digest for</span>
        {people.map((p) => {
          const active = p === selected;
          return (
            <Link
              key={p}
              href={`/digest?person=${encodeURIComponent(p)}`}
              aria-current={active ? "page" : undefined}
              className={[
                "inline-flex h-10 items-center gap-2 rounded-full py-1 pl-1 pr-4 text-[15px] transition-colors duration-150",
                active ? "bg-sheet font-medium text-ink shadow-control" : "text-ink-2 hover:bg-fill hover:text-ink",
              ].join(" ")}
            >
              <Avatar name={p} size={32} />
              {p}
            </Link>
          );
        })}
      </nav>

      {!selected || !facts ? (
        <EmptyState icon={<IconUsers size={22} />} title="Choose a teammate">
          Their digest covers open and overdue tasks, what they finished this week, decisions that affect them and items to discuss.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr]">
          <DigestCard key={selected} name={selected} initial={existingDigest(selected, today)} />
          <BasedOn facts={facts} today={today} />
        </div>
      )}
    </div>
  );
}

/** The exact facts the digest is written from, so nothing in it is a surprise. */
function BasedOn({ facts: f, today }: { facts: PersonFacts; today: string }) {
  const sections = [
    { title: "Overdue", tone: "text-live", items: f.overdue.map((t) => ({ text: t.title, meta: t.dueDate ? dueLabel(t.dueDate, today).text : "" })) },
    { title: "Open tasks", tone: "text-ink-2", items: f.open.map((t) => ({ text: t.title, meta: t.dueDate ? dueLabel(t.dueDate, today).text : "No deadline" })) },
    { title: "Done this week", tone: "text-go", items: f.doneThisWeek.map((t) => ({ text: t.title, meta: "" })) },
    { title: "Decisions that affect them", tone: "text-ink-2", items: f.decisions.map((d) => ({ text: d.text, meta: `${d.meetingTitle}, ${formatDayMonth(d.meetingDate)}` })) },
    { title: "To discuss", tone: "text-caution-ink", items: f.discuss.map((d) => ({ text: d.explanation, meta: d.meetingTitle })) },
  ];
  return (
    <aside aria-label="What the digest is based on" className="glass-flat min-w-0 rounded-[28px] p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Based on</h2>
      <p className="text-[13px] text-ink-3">Only these facts go to the AI.</p>
      <div className="mt-4 space-y-4">
        {sections.map((s) => (
          <section key={s.title}>
            <h3 className={`mb-1.5 text-[14px] font-medium ${s.tone}`}>
              {s.title} <span className="font-normal tabular-nums text-ink-3">{s.items.length}</span>
            </h3>
            {s.items.length === 0 ? (
              <p className="text-[14px] text-ink-3">None</p>
            ) : (
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-[14px] leading-snug">
                    <span className="min-w-0">{it.text}</span>
                    {it.meta && <span className="shrink-0 text-[12px] text-ink-3">{it.meta}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </aside>
  );
}

function DigestSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="glass-flat h-16 rounded-[24px] opacity-70" />
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="glass-flat h-72 rounded-[28px] opacity-70" />
        <div className="glass-flat h-72 rounded-[28px] opacity-70" />
      </div>
    </div>
  );
}
