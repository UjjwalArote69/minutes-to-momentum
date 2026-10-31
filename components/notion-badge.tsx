// Server- and client-safe: green "Sent to Notion" badge that links to the page.

export function NotionBadge({ url }: { url: string | null }) {
  const content = (
    <>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12 4.5 4.5L19 7" />
      </svg>
      Sent to Notion
    </>
  );
  const cls = "inline-flex h-7 items-center gap-1.5 rounded-full bg-go-soft px-3 text-[13px] font-medium text-go ring-1 ring-go/25";
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${cls} transition-opacity hover:opacity-80`} title="Open the page in Notion">
      {content}
      <span className="text-ink-2">Open</span>
    </a>
  ) : (
    <span className={cls}>{content}</span>
  );
}
