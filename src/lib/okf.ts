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
  const full = path.join(config.okfDir, relativePath);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  return { path: relativePath, frontmatter: fm, body };
}

/** List the markdown files in an OKF directory (one level deep). */
export function listOkfDir(relativeDir: string): string[] {
  const full = path.join(config.okfDir, relativeDir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(relativeDir, f).replace(/\\/g, "/"));
}

/** Extract the markdown section body under a `## Heading`. */
function sectionUnder(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (idx === -1) return null;
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  const text = out.join("\n").trim();
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
