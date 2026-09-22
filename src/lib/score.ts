// Client-safe score helpers (no server-only imports).

export function winProb(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.pow(10, -c / 400));
}

export function fmtCp(cp: number): string {
  return `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}
