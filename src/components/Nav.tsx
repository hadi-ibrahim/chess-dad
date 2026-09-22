import Link from "next/link";

export default function Nav() {
  const links = [
    { href: "/", label: "Games" },
    { href: "/insights", label: "Insights" },
    { href: "/puzzles", label: "Puzzles" },
    { href: "/openings", label: "Openings" },
    { href: "/knowledge", label: "Knowledge" },
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">♞</span>
          <span className="text-lg font-bold tracking-tight text-zinc-100">ChessMentor</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
