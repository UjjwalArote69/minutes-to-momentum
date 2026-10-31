"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDigest, IconHistory, IconMic, IconSun, IconTasks } from "./icons";

export const NAV_ITEMS = [
  { href: "/", label: "Today", icon: IconSun },
  { href: "/meetings/new", label: "New meeting", icon: IconMic },
  { href: "/tasks", label: "Tasks", icon: IconTasks },
  { href: "/decisions", label: "Decisions", icon: IconHistory },
  { href: "/digest", label: "Weekly digest", icon: IconDigest },
] as const;

function isActive(href: string, pathname: string | null) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Nav that highlights the current route. */
export function Nav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return <NavLinks orientation={orientation} pathname={pathname} />;
}

/** Plain links with no active state; used as the Suspense fallback. */
export function NavLinks({
  orientation,
  pathname = null,
}: {
  orientation: "vertical" | "horizontal";
  pathname?: string | null;
}) {
  const vertical = orientation === "vertical";
  return (
    <nav aria-label="Main">
      <ul className={vertical ? "flex flex-col gap-1" : "-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex h-10 items-center gap-3 rounded-full px-3.5 text-[15px] transition-colors duration-150",
                  active ? "bg-sheet font-medium text-ink shadow-control" : "text-ink-2 hover:bg-fill hover:text-ink",
                ].join(" ")}
              >
                <Icon size={18} className={active ? "text-ink" : "text-ink-3"} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
