// Shared classification colors for the review UI.

export const CLASS_COLORS: Record<string, string> = {
  brilliant: "#14b8a6",
  best: "#22c55e",
  great: "#4ade80",
  good: "#84cc16",
  inaccuracy: "#eab308",
  mistake: "#f97316",
  blunder: "#ef4444",
  miss: "#e11d48",
  book: "#94a3b8",
  forced: "#64748b",
};

export const CLASS_LABELS: Record<string, string> = {
  brilliant: "Brilliant",
  best: "Best",
  great: "Great",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
  miss: "Miss",
  book: "Book",
  forced: "Forced",
};

export function classColor(c: string | null | undefined): string {
  return CLASS_COLORS[c ?? ""] ?? "#71717a";
}
