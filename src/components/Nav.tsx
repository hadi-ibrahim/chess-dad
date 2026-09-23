"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Games" },
    { href: "/insights", label: "Insights" },
    { href: "/puzzles", label: "Puzzles" },
    { href: "/openings", label: "Openings" },
    { href: "/knowledge", label: "Knowledge" },
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      {/* Wraps instead of overflowing: these five labels have a 421px min-content
          width, which used to push the page into horizontal scroll under 571px. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          {/* Decorative: the wordmark beside it already names the app. */}
          <Image
            src="/logo-mark.png"
            alt=""
            width={56}
            height={56}
            className="h-7 w-7 shrink-0"
          />
          <span className="text-lg font-bold tracking-tight text-zinc-100">Chess Dad</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-md px-2.5 font-medium transition-colors sm:px-3 ${
                  active ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
