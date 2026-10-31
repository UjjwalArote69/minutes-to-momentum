import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { IconHistory } from "@/components/icons";
import { EmptyState, PageHeader, primaryButton } from "@/components/page-header";
import { formatDayMonth, formatShort } from "@/lib/dates";
import { decisionHistory, type HistoryDecision } from "@/lib/queries";

export const metadata: Metadata = { title: "Decisions" };

export default function DecisionsPage() {
  return (
    <>
      <PageHeader
        title="Decisions"
        description="Everything your team has decided, meeting by meeting. Replaced decisions stay here, crossed out, with the meeting that replaced them."
      />
      <Suspense fallback={<div className="glass-flat h-64 rounded-[28px] opacity-70" aria-hidden />}>
        <History />
      </Suspense>
    </>
  );
}

async function History() {
  await connection();
  const meetings = decisionHistory();

  if (meetings.length === 0) {
    return (
      <EmptyState
        icon={<IconHistory size={22} />}
        title="No decisions yet"
        action={
          <Link href="/meetings/new" className={primaryButton}>
            Capture a meeting
          </Link>
        }
      >
        Decisions from your meetings are remembered here, including the ones that were later replaced.
      </EmptyState>
    );
  }

  return (
    <ol className="space-y-8">
      {meetings.map((m) => (
        <li key={m.id} id={`meeting-${m.id}`} className="scroll-mt-24">
          <h2 className="mb-3 flex flex-wrap items-baseline gap-x-3 px-1">
            <span className="text-[20px] font-semibold tracking-[-0.015em]">{m.title}</span>
            <span className="text-[14px] text-ink-3">{formatShort(m.date)}</span>
          </h2>
          {m.decisions.length === 0 ? (
            <p className="glass-flat rounded-[24px] px-5 py-4 text-[14px] text-ink-3">No decisions in this meeting.</p>
          ) : (
            <ul className="sheet divide-y divide-hairline overflow-hidden rounded-[24px]">
              {m.decisions.map((d) => (
                <DecisionRow key={d.id} decision={d} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function DecisionRow({ decision: d }: { decision: HistoryDecision }) {
  const replaced = d.status === "superseded" || d.status === "reversed";
  return (
    <li className={`px-5 py-4 md:px-6 ${replaced ? "bg-fill/60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className={`min-w-0 flex-1 text-[16px] leading-snug ${replaced ? "text-ink-3 line-through decoration-ink-3/60" : "font-medium"}`}>
          {d.text}
        </p>
        {d.openConflict ? (
          <span className="inline-flex h-7 items-center gap-2 rounded-full bg-caution-soft px-3 text-[13px] font-medium text-caution-ink ring-1 ring-caution/40">
            <span className="size-1.5 rounded-full bg-caution" aria-hidden />
            Under discussion
          </span>
        ) : !replaced ? (
          <span className="text-[13px] font-medium text-go">In effect</span>
        ) : null}
      </div>
      {(d.rationale || d.owner) && (
        <p className="mt-1 text-[14px] text-ink-2">
          {[d.rationale?.replace(/\.$/, ""), d.owner && `owner ${d.owner}`].filter(Boolean).join(", ")}
        </p>
      )}
      {replaced && (
        <p className="mt-2 text-[14px] text-ink-2">
          <span className="font-medium text-ink">
            Replaced{d.replacedInTitle ? ` in ${d.replacedInTitle}` : ""}
            {d.replacedInDate ? `, ${formatDayMonth(d.replacedInDate)}` : ""}
          </span>
          {d.replacedByText ? `: “${d.replacedByText}”` : ""}
        </p>
      )}
    </li>
  );
}
