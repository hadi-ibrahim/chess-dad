import "server-only";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { computeWeaknesses } from "./weaknesses";

/**
 * Emit the player's aggregate progress back into the OKF bundle as a per-user
 * entity document. This is the "writes to it" half of the knowledge loop: the
 * app consumes coaching rules from `okf/concepts/` and contributes the
 * weakness profile it derives to `okf/progress/`.
 *
 * The output is generated knowledge about a person, so `okf/progress/` is
 * git-ignored; it is regenerated, never hand-edited.
 */

const ACTOR = "process:chessdad-analysis";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "player"
  );
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeFile(relativePath: string, contents: string): string {
  const full = path.join(config.okfDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return relativePath;
}

export interface ProgressBundleResult {
  written: string[];
  analyzedGames: number;
}

/**
 * Regenerate one account's progress documents. Safe to call repeatedly.
 *
 * Progress is written per **account** (`lichess:rooronoa`), not per profile: a
 * profile is a browser-local preference, and a document about a person should
 * not be filed under a browser.
 */
export function writeProgressBundle(scope: string): ProgressBundleResult {
  const [, account = ""] = scope.split(":");
  const username = account || "player";
  const w = computeWeaknesses("all", [scope]);

  if (w.analyzedGames === 0) {
    return { written: [], analyzedGames: 0 };
  }

  const now = new Date().toISOString();
  const slug = slugify(username);

  const lines: string[] = [];
  lines.push(`# ${username} — Progress`);
  lines.push("");
  lines.push(
    `${w.analyzedGames} of ${w.totalGames} imported games analysed` +
      (w.summary.avgAccuracy != null ? `, average accuracy ${w.summary.avgAccuracy.toFixed(1)}%.` : ".")
  );
  lines.push("");
  lines.push("# Weakness profile");
  lines.push("");
  lines.push("| Signal | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Blunders per game | ${w.summary.blunderRate.toFixed(2)} |`);
  lines.push(`| Mistakes + blunders + misses | ${w.classification.mistake + w.classification.blunder + w.classification.miss} |`);
  lines.push(`| Most common motif | ${w.summary.mostCommonMotif ?? "—"} |`);
  lines.push(`| Weakest phase | ${w.summary.weakestPhase ?? "—"} |`);
  lines.push(`| Moves analysed | ${w.totalPlayerMoves} |`);
  lines.push("");

  if (w.motifs.length > 0) {
    lines.push("# Recurring motifs");
    lines.push("");
    for (const m of w.motifs.slice(0, 8)) {
      lines.push(`* **${m.motif.replace(/-/g, " ")}** — ${m.count}`);
    }
    lines.push("");
  }

  if (Object.keys(w.phase).length > 0) {
    lines.push("# Phase performance");
    lines.push("");
    lines.push("| Phase | Moves | Mistakes | Avg loss (cp) |");
    lines.push("|-------|-------|----------|---------------|");
    for (const [phase, s] of Object.entries(w.phase)) {
      lines.push(`| ${phase} | ${s.moves} | ${s.blunders + s.mistakes} | ${s.avgCpLoss.toFixed(0)} |`);
    }
    lines.push("");
  }

  if (w.openings.length > 0) {
    lines.push("# Opening performance");
    lines.push("");
    lines.push("| ECO | Opening | Games | Win % |");
    lines.push("|-----|---------|-------|-------|");
    for (const o of w.openings.slice(0, 10)) {
      lines.push(`| ${o.eco} | ${o.name} | ${o.games} | ${o.winRate} |`);
    }
    lines.push("");
  }

  const fm = [
    "---",
    `type: ${yamlString("User Progress")}`,
    `title: ${yamlString(`${username} — Progress`)}`,
    `description: ${yamlString(`Analysis progress and weakness profile for ${username}.`)}`,
    "tags: [progress, weakness-profile]",
    "status: stable",
    `generated: { by: ${yamlString(ACTOR)}, at: ${yamlString(now)} }`,
    "---",
    "",
  ].join("\n");

  const written = [writeFile(`progress/${slug}.md`, fm + lines.join("\n"))];

  // A plain index (no frontmatter) linking the per-user documents.
  const index = ["# Progress", "", `* [${username} — Progress](${slug}.md)`, ""].join("\n");
  written.push(writeFile("progress/index.md", index));

  return { written, analyzedGames: w.analyzedGames };
}
