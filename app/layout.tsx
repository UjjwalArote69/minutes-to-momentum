import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Onest } from "next/font/google";
import { Nav, NavLinks } from "@/components/nav";
import { ReminderBell, ReminderBellFallback } from "@/components/reminder-bell";
import { ThemeToggle, themeInitScript } from "@/components/theme-toggle";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Minutes to Momentum", template: "%s | Minutes to Momentum" },
  description: "Turn meeting talk into tracked work: decisions, owners, deadlines and Notion tasks from a messy recap.",
};

/** Mark: a voice waveform settling into a tick (minutes -> momentum). */
function Mark() {
  return (
    <span className="grid size-9 place-items-center rounded-full bg-primary text-on-primary shadow-control">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 10v4M8 7v10M12 11v2" />
        <path d="m14.5 12.5 2.5 2.5 4.5-6" />
      </svg>
    </span>
  );
}

function Brand({ tagline = true }: { tagline?: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3 rounded-full">
      <Mark />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-tight tracking-[-0.01em]">Minutes to Momentum</span>
        {tagline && <span className="block text-[12px] leading-snug text-ink-3">Turn meeting talk into tracked work</span>}
      </span>
    </Link>
  );
}

function Bell() {
  return (
    <Suspense fallback={<ReminderBellFallback />}>
      <ReminderBell />
    </Suspense>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the init script may set data-theme before React hydrates.
    <html lang="en" className={`${onest.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full font-sans text-ink md:flex">
        <div className="ambient" aria-hidden />

        {/* Floating glass sidebar (desktop) */}
        <aside className="hidden shrink-0 p-3 md:sticky md:top-0 md:block md:h-screen md:w-[272px]">
          <div className="glass flex h-full flex-col gap-8 rounded-[28px] p-4">
            <div className="flex items-start justify-between gap-2 px-1 pt-1">
              <Brand />
            </div>
            <Suspense fallback={<NavLinks orientation="vertical" />}>
              <Nav orientation="vertical" />
            </Suspense>
            <div className="mt-auto space-y-3">
              <div className="flex items-center gap-3 rounded-[20px] bg-fill p-2 pr-3">
                <Bell />
                <span className="leading-tight">
                  <span className="block text-[14px] font-medium">Reminders</span>
                  <span className="block text-[12px] text-ink-3">Overdue or due within 48 hours</span>
                </span>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </aside>

        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-20 p-2 md:hidden">
          <div className="glass flex flex-col gap-3 rounded-[24px] px-3 pb-2 pt-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <Brand tagline={false} />
              <div className="flex shrink-0 items-center gap-2">
                <Bell />
                <ThemeToggle compact />
              </div>
            </div>
            <Suspense fallback={<NavLinks orientation="horizontal" />}>
              <Nav orientation="horizontal" />
            </Suspense>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 md:px-10 md:pt-12">{children}</div>
        </main>
      </body>
    </html>
  );
}
