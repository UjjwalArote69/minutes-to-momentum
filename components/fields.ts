// Shared field styles (plain strings, safe for server and client components).

/** Borderless text that reveals itself as a field on hover/focus (like Apple Notes / Reminders). */
export const inlineField =
  "-mx-2 w-[calc(100%+1rem)] rounded-[10px] bg-transparent px-2 py-1 transition-colors duration-150 placeholder:text-ink-3 hover:bg-fill focus:bg-sheet focus:shadow-control focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-blue/35";

/** Small pill input (owner, date, topic). */
export const pillField =
  "h-8 rounded-full bg-fill px-3 text-[14px] text-ink transition-colors duration-150 placeholder:text-ink-3 hover:bg-fill-hover focus:bg-sheet focus:shadow-control focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-blue/35";

/** Pill input that still needs a value ("needs clarification"). */
export const pillFieldMissing =
  "h-8 rounded-full bg-attention-soft px-3 text-[14px] text-ink ring-1 ring-attention/70 transition-colors duration-150 placeholder:text-attention-ink focus:bg-sheet focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-blue/35";
