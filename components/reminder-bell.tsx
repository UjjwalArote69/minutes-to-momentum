import Link from "next/link";
import { connection } from "next/server";
import { todayIso } from "@/lib/dates";
import { reminderCount } from "@/lib/queries";
import { IconBell } from "./icons";

const bellClass =
  "relative grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2 transition-colors duration-150 hover:bg-fill-hover hover:text-ink";

/** Bell with the number of open tasks that are overdue or due within 48 hours. */
export async function ReminderBell() {
  await connection();
  const n = reminderCount(todayIso());
  return (
    <Link href="/#reminders" className={bellClass} aria-label={n ? `${n} reminders: overdue or due within 48 hours` : "No reminders"} title="Reminders">
      <IconBell size={19} />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-live px-1 text-[11px] font-semibold tabular-nums text-white ring-2 ring-[var(--sheet)]">
          {n > 9 ? "9+" : n}
        </span>
      )}
    </Link>
  );
}

export function ReminderBellFallback() {
  return (
    <span className={bellClass} aria-hidden>
      <IconBell size={19} />
    </span>
  );
}
