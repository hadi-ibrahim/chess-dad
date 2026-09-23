// Shared classification vocabulary for the review UI.
//
// Colours are chosen for >=4.5:1 contrast on the app's #09090b page: `miss` and
// `forced` were both below that bar, and `miss` sat too close to `blunder` to be
// told apart at a glance.

export const CLASS_COLORS: Record<string, string> = {
  brilliant: "#14b8a6",
  best: "#22c55e",
  great: "#4ade80",
  good: "#84cc16",
  inaccuracy: "#eab308",
  mistake: "#f97316",
  blunder: "#ef4444",
  miss: "#fb7185",
  book: "#94a3b8",
  forced: "#9fb0c3",
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

/**
 * Standard chess annotation marks, so classification never rests on colour
 * alone. Neutral moves carry no glyph: only the errors (and a brilliancy) earn
 * one, which is what a player scans a score sheet for.
 *
 * `miss` is `!?` rather than a cross: a cross reads as capture notation next to
 * SAN (the badge on e5 after `Re5` looked like "capture on e5").
 */
export const CLASS_GLYPHS: Record<string, string> = {
  brilliant: "!!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
  miss: "!?",
};

/** One-line definitions for the legend, matching okf/concepts/move-classification.md. */
export const CLASS_BLURBS: Record<string, string> = {
  brilliant: "A sound sacrifice that is also the engine's choice",
  best: "The engine's top move",
  great: "Within 10 centipawns of best",
  good: "10–50 centipawns lost",
  inaccuracy: "50–100 centipawns lost",
  mistake: "100–300 centipawns lost",
  blunder: "Over 300 centipawns lost",
  miss: "A forced mate or winning tactic was available",
  book: "Still inside opening theory",
  forced: "The only legal move",
};

/** Display order for legends and tallies: best first, worst last. */
export const CLASS_ORDER = [
  "brilliant",
  "best",
  "great",
  "good",
  "book",
  "forced",
  "inaccuracy",
  "mistake",
  "blunder",
  "miss",
];

/** Classes that mean a move is worth reviewing. */
export const ERROR_CLASSES = new Set(["inaccuracy", "mistake", "blunder", "miss"]);

export function classColor(c: string | null | undefined): string {
  return CLASS_COLORS[c ?? ""] ?? "#a1a1aa";
}

export function classLabel(c: string | null | undefined): string {
  return CLASS_LABELS[c ?? ""] ?? (c ? c : "Unclassified");
}

export function classGlyph(c: string | null | undefined): string {
  return CLASS_GLYPHS[c ?? ""] ?? "";
}

export function isError(c: string | null | undefined): boolean {
  return ERROR_CLASSES.has(c ?? "");
}
