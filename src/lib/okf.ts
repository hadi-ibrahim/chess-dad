import "server-only";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * Minimal, dependency-free reader for the Chess Dad OKF knowledge bundle.
 *
 * The bundle is authored as plain markdown with YAML frontmatter (OKF v0.2).
 * This module lets the app consume its own knowledge — e.g. the deterministic
 * coaching fallback grounds its explanations in `concepts/coaching-rules.md`.
 */

export interface OkfDoc {
  path: string;
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm: Record<string, string> = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
  }
  return { fm, body };
}

export function readOkfDoc(relativePath: string): OkfDoc | null {
  const root = path.resolve(config.okfDir);
  const full = path.resolve(root, relativePath);
  // Confine reads to the bundle. `path.join` normalises `..`, so without this
  // check a caller-supplied path walks straight out of `okf/`. Nothing passes a
  // user-controlled path today — the coach reads fixed filenames — but the guard
  // is what keeps that true if anyone ever wires this to a request.
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (path.extname(full) !== ".md") return null;
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  return { path: relativePath, frontmatter: fm, body };
}

/**
 * Extract the markdown section body under a heading, at any level.
 *
 * The bundle mixes heading levels: `coaching-rules.md` uses `## Move
 * classification: blunder`, while `tactical-motifs.md` uses `# How to train`. This
 * used to match only `##`, so the drill text could never be found and
 * `readCoachingRules` always returned an empty drill — the coach then silently
 * fell back to hard-coded text instead of the knowledge base it claims to be
 * grounded in.
 */
function sectionUnder(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const wanted = heading.trim().toLowerCase();

  const start = lines.findIndex((line) => {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    return m ? m[2].toLowerCase() === wanted : false;
  });
  if (start === -1) return null;

  const level = (lines[start].match(/^(#{1,6})/) as RegExpMatchArray)[1].length;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const next = lines[i].match(/^(#{1,6})\s/);
    // A section ends at the next heading of the same or a higher level.
    if (next && next[1].length <= level) break;
    out.push(lines[i]);
  }

  const text = out
    .filter((line) => !/^\[\^[^\]]+\]:/.test(line.trim())) // drop footnote definitions
    .join("\n")
    .trim();
  return text || null;
}

/**
 * Read the coaching-rules concept document and return a map of
 * classification -> { lesson, drill } for the deterministic fallback.
 * If the OKF bundle is missing, returns an empty map (callers should degrade).
 */
export function readCoachingRules(): Record<string, { lesson: string; drill: string }> {
  const doc = readOkfDoc("concepts/coaching-rules.md");
  if (!doc) return {};
  const out: Record<string, { lesson: string; drill: string }> = {};
  for (const cls of ["blunder", "mistake", "miss", "inaccuracy", "good"]) {
    const lesson = sectionUnder(doc.body, `Move classification: ${cls}`) ?? sectionUnder(doc.body, cls);
    if (lesson) {
      out[cls] = { lesson, drill: "" };
    }
  }
  const drills = readOkfDoc("concepts/tactical-motifs.md");
  if (drills) {
    for (const [cls, v] of Object.entries(out)) {
      const drill = sectionUnder(drills.body, v.lesson ? "Drill" : cls) ?? sectionUnder(drills.body, "How to train");
      if (drill) v.drill = drill;
    }
  }
  return out;
}
