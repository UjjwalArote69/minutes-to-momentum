// Server- and client-safe (no hooks).

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Same name always gets the same soft tone. */
function avatarTone(name: string): string {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--av-${(h % 5) + 1})`;
}

/** Initials on a soft tone. An empty name renders a dashed yellow "?" (owner needs clarification). */
export function Avatar({ name, size = 40 }: { name: string | null; size?: number }) {
  if (!name?.trim()) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(12, size * 0.36) }}
        className="grid shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-attention bg-attention-soft font-semibold text-attention-ink"
      >
        ?
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: avatarTone(name), fontSize: size * 0.36 }}
      className="grid shrink-0 place-items-center rounded-full font-semibold tracking-[0.01em] text-ink ring-2 ring-[var(--avatar-ring)]"
    >
      {initials(name)}
    </span>
  );
}
