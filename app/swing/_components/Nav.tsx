"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/swing", label: "Overview" },
  { href: "/swing/positions", label: "Positions" },
  { href: "/swing/trades", label: "Trade log" },
];

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/swing/login")) return null;
  return (
    <header className="border-b border-border bg-surface-2/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        <Link href="/swing" className="font-semibold tracking-tight">
          Swing Trade Hunter
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/swing" ? path === "/swing" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md ${active ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
              </Link>
            );
          })}
          <a href="/" className="px-3 py-1.5 rounded-md text-ink-2 hover:text-ink">
            Value Hunter ↗
          </a>
        </nav>
        <form action="/api/swing/logout" method="post" className="ml-auto">
          <button className="text-xs text-muted hover:text-ink">Sign out</button>
        </form>
      </div>
    </header>
  );
}
