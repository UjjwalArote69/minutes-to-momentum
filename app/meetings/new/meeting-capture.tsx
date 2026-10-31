"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { primaryButton, secondaryButton } from "@/components/page-header";
import {
  MAX_TRANSCRIPT_CHARS,
  MIN_TRANSCRIPT_CHARS,
  needsDeadline,
  needsOwner,
  type ConflictResolution,
  type DraftActionItem,
  type DraftConflict,
  type DraftDecision,
  type FriendlyError,
  type MeetingDraft,
  type SaveMeetingResult,
} from "@/lib/meeting-types";
import { demoNewMeeting } from "@/lib/demo-sample";
import { checkConflictsAction, processMeetingAction, saveMeetingAction } from "./actions";
import { ApprovePanel } from "./approve-panel";
import { ConflictCard, type NewSide } from "./conflict-cards";
import { ActionRow, ClarifyBadge, DecisionTile, PeopleRow, SectionTitle, SummaryPanel } from "./review-cards";
import { useSpeechRecognition } from "./use-speech-recognition";

const VOICE_LANGS = [
  { value: "en-IN", label: "English (India), good for Hinglish" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "hi-IN", label: "हिन्दी (Hindi)" },
];

const LOADING_STEPS = [
  "Reading your meeting",
  "Clearing out the ums, uhs and false starts",
  "Following the self-corrections",
  "Finding the decisions",
  "Working out owners and deadlines",
  "Checking against past meetings",
  "Almost done",
];

const noopSubscribe = () => () => {};
/** Today in the user's timezone as YYYY-MM-DD ("" during server render). */
function useToday(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => new Date().toLocaleDateString("en-CA"),
    () => "",
  );
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function MeetingCapture() {
  const today = useToday();
  const [title, setTitle] = useState("");
  const [dateInput, setDateInput] = useState<string | null>(null); // null = use today
  const meetingDate = dateInput ?? today;
  const [transcript, setTranscript] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const [lang, setLang] = useState("en-IN");

  const [processing, setProcessing] = useState(false);
  const [draft, setDraft] = useState<MeetingDraft | null>(null);
  const [processedText, setProcessedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Extract<SaveMeetingResult, { ok: true }> | null>(null);
  const [error, setError] = useState<(FriendlyError & { during: "process" | "save" }) | null>(null);
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [conflictError, setConflictError] = useState<FriendlyError | null>(null);
  const [checking, setChecking] = useState(false);
  const conflictsRef = useRef<HTMLDivElement>(null);

  const reviewRef = useRef<HTMLDivElement>(null);
  const peopleListId = useId();

  const speech = useSpeechRecognition((text) => {
    setUsedVoice(true);
    setTranscript((t) => (t === "" ? text : /\s$/.test(t) ? t + text : `${t} ${text}`));
  });

  // Recording timer (resets each time recording starts).
  const recordStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!speech.listening) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recordStartRef.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [speech.listening]);

  function toggleRecording() {
    if (speech.listening) {
      speech.stop();
    } else {
      recordStartRef.current = Date.now();
      setElapsed(0);
      speech.start(lang);
    }
  }

  const chars = transcript.trim().length;
  const tooShort = chars < MIN_TRANSCRIPT_CHARS;
  const tooLong = chars > MAX_TRANSCRIPT_CHARS;
  const canProcess = !processing && !speech.listening && !tooShort && !tooLong && meetingDate !== "";

  // Scroll to the results once, right after a successful Process (not on every edit).
  const scrollToReviewRef = useRef(false);
  useEffect(() => {
    if (!processing && scrollToReviewRef.current) {
      scrollToReviewRef.current = false;
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [processing]);

  async function process(fresh = false) {
    if (!canProcess) return;
    setProcessing(true);
    setError(null);
    setSaved(null);
    try {
      const res = await processMeetingAction({ title, meetingDate, transcript, fresh });
      if (res.ok) {
        setDraft(res.draft);
        setConflicts(res.conflicts);
        setConflictError(res.conflictError);
        setProcessedText(transcript);
        scrollToReviewRef.current = true;
      } else {
        setError({ ...res.error, during: "process" });
      }
    } catch {
      setError({
        kind: "api",
        title: "Can't reach the app",
        message: "The request didn't reach the server. Check that `npm run dev` is still running, then try again.",
        retryable: true,
        during: "process",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function recheckConflicts() {
    if (!draft || checking) return;
    setChecking(true);
    setConflictError(null);
    try {
      const res = await checkConflictsAction({
        title,
        meetingDate,
        decisions: draft.decisions.map(({ id, text }) => ({ id, text })),
        actionItems: draft.actionItems.map(({ id, task, owner, dueDate }) => ({ id, task, owner, dueDate })),
      });
      if (res.ok) setConflicts(res.conflicts);
      else setConflictError(res.error);
    } catch {
      setConflictError({ kind: "api", title: "Can't reach the app", message: "Check that `npm run dev` is still running.", retryable: true });
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (!draft || saving) return;
    if (unresolved.length > 0) {
      conflictsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await saveMeetingAction({
        title: title.trim() || `Meeting on ${meetingDate}`,
        meetingDate,
        source: usedVoice ? "voice" : "paste",
        rawTranscript: processedText,
        cleanTranscript: draft.cleanTranscript,
        summary: draft.summary,
        people: draft.people,
        // Blank entries are treated as deleted; "Keep old" leaves the new item out.
        decisions: draft.decisions
          .filter((d) => d.text.trim() && !excludedIds.has(d.id))
          .map(({ id, text, reason, topic }) => ({ key: id, text, reason, topic })),
        actionItems: draft.actionItems
          .filter((a) => a.task.trim() && !excludedIds.has(a.id))
          .map(({ id, task, owner, dueDate, sourceQuote }) => ({ key: id, task, owner, dueDate, sourceQuote })),
        conflicts: visibleConflicts.map((c) => ({
          type: c.type,
          explanation: c.explanation,
          newKind: c.newItem.kind,
          newKey: c.newItem.id,
          newText: newSideFor(c).text || "(empty)",
          oldKind: c.old.kind,
          oldId: c.old.id,
          resolution: c.resolution as ConflictResolution,
        })),
      });
      if (res.ok) setSaved(res);
      else setError({ ...res.error, during: "save" });
    } catch {
      setError({
        kind: "db",
        title: "Can't reach the app",
        message: "The save didn't reach the server. Your edits are still here, so try again.",
        retryable: true,
        during: "save",
      });
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    setTitle("");
    setDateInput(null);
    setTranscript("");
    setUsedVoice(false);
    setDraft(null);
    setConflicts([]);
    setConflictError(null);
    setProcessedText("");
    setSaved(null);
    setError(null);
    setElapsed(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Draft editing helpers
  const patchDraft = (patch: Partial<MeetingDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const patchDecision = (id: string, patch: Partial<DraftDecision>) =>
    setDraft((d) => d && { ...d, decisions: d.decisions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const patchAction = (id: string, patch: Partial<DraftActionItem>) =>
    setDraft((d) => d && { ...d, actionItems: d.actionItems.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  // Conflicts whose new item was deleted from the draft no longer count.
  const visibleConflicts = conflicts.filter((c) =>
    c.newItem.kind === "decision"
      ? draft?.decisions.some((d) => d.id === c.newItem.id)
      : draft?.actionItems.some((a) => a.id === c.newItem.id),
  );
  const unresolved = visibleConflicts.filter((c) => !c.resolution);
  const excludedIds = new Set(visibleConflicts.filter((c) => c.resolution === "keep_old").map((c) => c.newItem.id));
  const resolve = (id: string, resolution: ConflictResolution) =>
    setConflicts((cs) => cs.map((c) => (c.id === id ? { ...c, resolution } : c)));
  function newSideFor(c: DraftConflict): NewSide {
    if (c.newItem.kind === "decision") return { text: draft?.decisions.find((d) => d.id === c.newItem.id)?.text ?? "" };
    const a = draft?.actionItems.find((x) => x.id === c.newItem.id);
    return { text: a?.task ?? "", owner: a?.owner || undefined, dueDate: a?.dueDate || undefined };
  }
  /** Small note on a decision/action that is part of a conflict. */
  function flagFor(itemId: string): { tone: "excluded" | "conflict"; text: string } | undefined {
    if (excludedIds.has(itemId)) return { tone: "excluded", text: "Won't be saved: you kept the old one" };
    const c = visibleConflicts.find((x) => x.newItem.id === itemId && !x.resolution);
    if (c) return { tone: "conflict", text: `Conflicts with ${c.old.meetingTitle}. Choose above` };
    return undefined;
  }

  const unclearCount =
    draft?.actionItems.filter((a) => !excludedIds.has(a.id) && (needsOwner(a) || needsDeadline(a))).length ?? 0;
  const transcriptChanged = draft !== null && transcript !== processedText;

  if (saved) {
    return <ApprovePanel saved={saved} onStartOver={startOver} />;
  }

  return (
    <div className="space-y-12">
      {/* ---------------- Capture ---------------- */}
      <section aria-label="Capture the meeting" className="space-y-4">
        <div
          className={[
            "glass overflow-hidden rounded-[32px] transition-[box-shadow] duration-300",
            speech.listening ? "ring-2 ring-live/50" : "",
          ].join(" ")}
        >
          {/* Title + date */}
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-6 py-4 md:px-8">
            <input
              aria-label="Meeting title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting title"
              maxLength={200}
              className="min-w-0 flex-1 basis-full bg-transparent text-[24px] sm:basis-auto font-semibold tracking-[-0.02em] placeholder:text-ink-3/70 focus:outline-none focus-visible:outline-none"
            />
            <label className="inline-flex h-9 items-center gap-2 rounded-full bg-fill pl-3.5 pr-2 text-[14px] text-ink-2">
              <span>Held on</span>
              <input
                type="date"
                aria-label="Meeting date"
                value={meetingDate}
                onChange={(e) => setDateInput(e.target.value)}
                className="bg-transparent font-medium text-ink focus:outline-none focus-visible:outline-none"
              />
            </label>
          </div>

          {/* The recap */}
          <label htmlFor="transcript" className="sr-only">
            Meeting recap or transcript
          </label>
          <textarea
            id="transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={
              "Speak or paste your meeting here\n\nMessy is fine. If you paste a transcript, speaker names help:\nPriya: let's ship on Friday\nRahul: I'll send the deck tomorrow"
            }
            className="block min-h-[340px] w-full resize-y bg-transparent px-6 py-6 text-[18px] leading-[1.65] placeholder:text-ink-3 focus:outline-none focus-visible:outline-none md:px-8"
          />
          {speech.interim && (
            <p className="px-6 pb-4 text-[18px] leading-[1.65] text-ink-3 md:px-8" aria-live="polite">
              {speech.interim}
            </p>
          )}

          {/* Controls */}
          <div className="grid grid-cols-1 items-center gap-4 border-t border-hairline px-5 py-4 md:grid-cols-[1fr_auto_1fr] md:px-6">
            <div className="order-2 flex flex-wrap items-center gap-2 md:order-1">
              {speech.supported && (
                <select
                  aria-label="Voice language"
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  disabled={speech.listening}
                  className="h-9 max-w-[16rem] truncate rounded-full bg-fill px-3.5 text-[14px] text-ink-2 transition-colors hover:bg-fill-hover focus:outline-none disabled:opacity-50"
                >
                  {VOICE_LANGS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
              {!transcript ? (
                <button
                  type="button"
                  onClick={() => {
                    const sample = demoNewMeeting(meetingDate || today);
                    setTranscript(sample.transcript);
                    if (!title) setTitle(sample.title);
                  }}
                  className="h-9 rounded-full px-3.5 text-[14px] font-medium text-blue transition-colors hover:bg-fill"
                >
                  Try a sample
                </button>
              ) : (
                !speech.listening &&
                !processing && (
                  <button
                    type="button"
                    onClick={() => setTranscript("")}
                    className="h-9 rounded-full px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-fill hover:text-ink"
                  >
                    Clear
                  </button>
                )
              )}
            </div>

            {/* Recorder: the one bold control */}
            <div className="order-1 flex items-center justify-center gap-3 md:order-2">
              {speech.supported ? (
                <>
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={processing}
                    aria-pressed={speech.listening}
                    aria-label={speech.listening ? "Stop recording" : "Start recording"}
                    className={[
                      "grid size-16 place-items-center rounded-full bg-sheet shadow-control transition-[transform,box-shadow] duration-150 active:scale-95 disabled:opacity-40",
                      speech.listening ? "ring-[3px] ring-live/35" : "ring-1 ring-hairline",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "block bg-live transition-[width,height,border-radius] duration-200 ease-out-soft",
                        speech.listening ? "size-6 rounded-[7px]" : "size-7 rounded-full",
                      ].join(" ")}
                    />
                  </button>
                  <div className="w-28 whitespace-nowrap leading-tight">
                    <p className={`text-[17px] font-medium tabular-nums ${speech.listening ? "text-live" : "text-ink"}`}>
                      {speech.listening ? formatClock(elapsed) : transcript ? "Keep talking" : "Record"}
                    </p>
                    <p className="text-[13px] text-ink-3">{speech.listening ? "Tap to stop" : "Tap to speak"}</p>
                  </div>
                </>
              ) : (
                <p className="max-w-xs text-center text-[14px] text-ink-2">
                  Voice typing works in Chrome and Edge. You can paste a transcript here instead.
                </p>
              )}
            </div>

            <div className="order-3 flex items-center justify-end gap-4">
              <span className={`text-[13px] tabular-nums ${tooLong ? "text-live" : "text-ink-3"}`}>
                {chars.toLocaleString()} characters
              </span>
              <button type="button" onClick={() => process()} disabled={!canProcess} className={primaryButton}>
                {processing ? (
                  <>
                    <Spinner /> Processing
                  </>
                ) : draft ? (
                  "Process again"
                ) : (
                  "Process"
                )}
              </button>
            </div>
          </div>
        </div>

        {speech.listening && (
          <p className="px-2 text-[14px] text-ink-2">
            Listening. Mixing Hindi and English or correcting yourself (&ldquo;Friday, no wait, Monday&rdquo;) is fine.
          </p>
        )}
        {speech.error && <Banner tone="danger" title="Voice typing stopped" message={speech.error} />}
        {transcriptChanged && !processing && (
          <p className="px-2 text-[14px] text-ink-2">
            You&apos;ve changed the text since it was processed. Press Process again to update the results.
          </p>
        )}
        {error?.during === "process" && (
          <Banner
            tone={error.kind === "rate_limit" || error.kind === "quota" || error.kind === "busy" ? "attention" : "danger"}
            title={error.title}
            message={error.message}
            action={error.retryable && canProcess ? { label: "Try again", onClick: () => process() } : undefined}
          />
        )}
      </section>

      {/* ---------------- Loading ---------------- */}
      {processing && <LoadingState />}

      {/* ---------------- Review ---------------- */}
      {draft && !processing && (
        <section ref={reviewRef} aria-label="Review the results" className="scroll-mt-28 space-y-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[28px] font-semibold tracking-[-0.022em]">Review</h2>
              <p className="mt-1 text-[15px] text-ink-2">Edit anything that looks off. Nothing is saved until you press Save meeting.</p>
            </div>
            <button
              type="button"
              onClick={() => process(true)}
              disabled={!canProcess}
              title="Ask the AI again instead of using the saved answer"
              className="h-9 rounded-full px-3.5 text-[14px] font-medium text-blue transition-colors hover:bg-fill disabled:opacity-40"
            >
              Ask the AI again
            </button>
          </div>

          {conflictError && (
            <Banner
              tone="attention"
              title="Couldn't check this meeting against past ones"
              message={`${conflictError.message} You can still review and save, or check again.`}
              action={{ label: checking ? "Checking" : "Check again", onClick: recheckConflicts }}
            />
          )}

          {visibleConflicts.length > 0 && (
            <section ref={conflictsRef} aria-label="Conflicts with past meetings" className="scroll-mt-28">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em]">
                    Conflicts with past meetings <span className="font-normal tabular-nums text-ink-3">{visibleConflicts.length}</span>
                  </h3>
                  <p className="mt-1 text-[15px] text-ink-2">
                    {unresolved.length > 0
                      ? `This meeting changes things your team already agreed. Choose what happens to each one: ${unresolved.length} left.`
                      : "Every conflict has a choice. You can still change your mind before saving."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={recheckConflicts}
                  disabled={checking}
                  title="Run the memory check again after editing items (resets your choices)"
                  className="h-9 rounded-full px-3.5 text-[14px] font-medium text-blue transition-colors hover:bg-fill disabled:opacity-40"
                >
                  {checking ? "Checking" : "Check again"}
                </button>
              </div>
              <div className="space-y-4">
                {visibleConflicts.map((c) => (
                  <ConflictCard key={c.id} conflict={c} newSide={newSideFor(c)} onResolve={(r) => resolve(c.id, r)} />
                ))}
              </div>
            </section>
          )}

          <SummaryPanel
            summary={draft.summary}
            cleanTranscript={draft.cleanTranscript}
            onChange={(summary) => patchDraft({ summary })}
          />

          <PeopleRow people={draft.people} onChange={(people) => patchDraft({ people })} />
          <datalist id={peopleListId}>
            {draft.people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>

          <section>
            <SectionTitle
              title="Decisions"
              count={draft.decisions.length}
              action={{
                label: "Add decision",
                onClick: () =>
                  patchDraft({
                    decisions: [...draft.decisions, { id: crypto.randomUUID(), text: "", reason: "", topic: "" }],
                  }),
              }}
            />
            {draft.decisions.length === 0 ? (
              <EmptyNote>No decisions were made in this meeting.</EmptyNote>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {draft.decisions.map((d) => (
                  <DecisionTile
                    key={d.id}
                    decision={d}
                    flag={flagFor(d.id)}
                    onChange={(patch) => patchDecision(d.id, patch)}
                    onRemove={() => patchDraft({ decisions: draft.decisions.filter((x) => x.id !== d.id) })}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              title="Action items"
              count={draft.actionItems.length}
              badge={unclearCount > 0 ? <ClarifyBadge>{unclearCount} need clarification</ClarifyBadge> : null}
              action={{
                label: "Add action item",
                onClick: () =>
                  patchDraft({
                    actionItems: [
                      ...draft.actionItems,
                      { id: crypto.randomUUID(), task: "", owner: "", dueDate: "", deadlineSaid: "", sourceQuote: "", question: "" },
                    ],
                  }),
              }}
            />
            {draft.actionItems.length === 0 ? (
              <EmptyNote>No action items came out of this meeting.</EmptyNote>
            ) : (
              <ul className="sheet divide-y divide-hairline overflow-hidden rounded-[28px]">
                {draft.actionItems.map((a) => (
                  <ActionRow
                    key={a.id}
                    item={a}
                    flag={flagFor(a.id)}
                    peopleListId={peopleListId}
                    onChange={(patch) => patchAction(a.id, patch)}
                    onRemove={() => patchDraft({ actionItems: draft.actionItems.filter((x) => x.id !== a.id) })}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Save bar */}
          <div className="sticky bottom-4 z-10">
            {error?.during === "save" && (
              <div className="mb-3">
                <Banner tone="danger" title={error.title} message={error.message} />
              </div>
            )}
            <div className="glass-strong flex flex-wrap items-center justify-between gap-3 rounded-[28px] py-3 pl-6 pr-3 md:rounded-full">
              <p className="text-[14px] text-ink-2">
                {unresolved.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => conflictsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="font-semibold text-caution-ink underline-offset-2 hover:underline"
                    >
                      {unresolved.length} {unresolved.length === 1 ? "conflict needs" : "conflicts need"} a choice
                    </button>{" "}
                    before you can save.{" "}
                  </>
                ) : null}
                {unclearCount > 0
                  ? `${unclearCount} action item${unclearCount === 1 ? "" : "s"} still need${unclearCount === 1 ? "s" : ""} an owner or a deadline. You can save now and fix ${unclearCount === 1 ? "it" : "them"} later.`
                  : "Every action item has an owner and a deadline."}{" "}
                <span className="text-ink-3">Saved here only, not sent to Notion yet.</span>
              </p>
              <button
                type="button"
                onClick={save}
                disabled={saving || unresolved.length > 0}
                title={unresolved.length > 0 ? "Choose what to do with every conflict first" : undefined}
                className={primaryButton}
              >
                {saving ? (
                  <>
                    <Spinner /> Saving
                  </>
                ) : (
                  "Save meeting"
                )}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LoadingState() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <section aria-label="Processing" aria-busy className="space-y-5">
      <div className="glass flex items-center gap-4 rounded-[28px] px-6 py-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sheet shadow-control">
          <Spinner />
        </span>
        <div>
          <p className="text-[17px] font-medium" aria-live="polite">
            {LOADING_STEPS[step]}
          </p>
          <p className="text-[14px] text-ink-2">Usually 5 to 20 seconds. If Gemini is busy we wait and retry once, which can take up to a minute.</p>
        </div>
      </div>
      <div className="sheet divide-y divide-hairline overflow-hidden rounded-[28px] opacity-70" aria-hidden>
        {[0.62, 0.48, 0.55].map((w, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-5">
            <span className="size-10 rounded-full bg-fill" />
            <div className="flex-1 space-y-2.5">
              <div className="h-3.5 rounded-full bg-fill" style={{ width: `${w * 100}%` }} />
              <div className="h-3 w-40 rounded-full bg-fill" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="glass-flat rounded-[24px] px-6 py-8 text-center text-[15px] text-ink-2">{children}</p>;
}

function Banner({
  tone,
  title,
  message,
  action,
}: {
  tone: "attention" | "danger";
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div role="alert" className="glass-strong flex flex-wrap items-start gap-4 rounded-[24px] px-5 py-4">
      <span
        aria-hidden
        className={`mt-1 grid size-6 shrink-0 place-items-center rounded-full ${tone === "attention" ? "bg-attention-soft text-attention-ink" : "bg-live-soft text-live"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 7v6M12 17v.01" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{message}</p>
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className={`${secondaryButton} h-9 px-4 text-[14px]`}>
          {action.label}
        </button>
      )}
    </div>
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
