// Date helpers for YYYY-MM-DD strings (client- and server-safe). All math is done in UTC so
// a date string never shifts by a day because of the machine's timezone.

const DAY_MS = 86_400_000;

/** Today in the local timezone. Call at request time only (after `await connection()`). */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso).getTime() - toUtc(fromIso).getTime()) / DAY_MS);
}

/** Monday of the week containing the date. */
export function weekStartIso(iso: string): string {
  const dow = (toUtc(iso).getUTCDay() + 6) % 7; // Mon = 0
  return addDaysIso(iso, -dow);
}

/** "Mon 2 Nov" */
export function formatShort(iso: string): string {
  return toUtc(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Saturday, 31 October" */
export function formatLong(iso: string): string {
  return toUtc(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** "November 30" (how people say it out loud) */
export function formatSpoken(iso: string): string {
  return toUtc(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** "2 Nov" */
export function formatDayMonth(iso: string): string {
  return toUtc(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** Human due label relative to today: "2 days overdue", "Today", "Tomorrow", "Thursday", "Mon 16 Nov". */
export function dueLabel(due: string, today: string): { text: string; tone: DueTone } {
  const diff = daysBetween(today, due);
  if (diff < 0) return { text: diff === -1 ? "Due yesterday" : `${-diff} days overdue`, tone: "overdue" };
  if (diff === 0) return { text: "Due today", tone: "today" };
  if (diff === 1) return { text: "Due tomorrow", tone: "soon" };
  if (diff < 7) {
    return { text: `Due ${toUtc(due).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}`, tone: "soon" };
  }
  return { text: `Due ${formatShort(due)}`, tone: "later" };
}
