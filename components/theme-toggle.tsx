"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

/**
 * Runs in <head> before first paint so a saved theme never flashes the wrong colors.
 * Keep in sync with applyTheme() below.
 */
export const themeInitScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function subscribe(onChange: () => void) {
  // Another tab changed the theme: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode): still switch for this page view.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "Auto",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    ),
  },
];

/** Segmented control: Auto (follow the system) / Light / Dark. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex rounded-full bg-fill p-1">
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={compact ? `${o.label} theme` : undefined}
            title={o.value === "system" ? "Match your device" : `${o.label} theme`}
            onClick={() => setTheme(o.value)}
            className={[
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] transition-colors duration-150",
              compact ? "w-8 flex-none" : "px-2",
              active ? "bg-sheet font-medium text-ink shadow-control" : "text-ink-3 hover:text-ink",
            ].join(" ")}
          >
            {o.icon}
            {!compact && o.label}
          </button>
        );
      })}
    </div>
  );
}
