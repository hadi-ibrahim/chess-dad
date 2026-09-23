#!/usr/bin/env node
/**
 * One-command Stockfish setup helper.
 *
 * Chess Dad needs a UCI Stockfish binary. This script:
 *   1. uses an existing `STOCKFISH_PATH` or a `stockfish` on PATH, or
 *   2. installs it via Homebrew (macOS), or
 *   3. downloads the official release binary (Linux) into ./engines.
 *
 * Usage:  node scripts/setup-engine.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { platform, arch } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const enginesDir = path.join(root, "engines");

function has(bin) {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (r.error) {
    // some builds don't support --version but still respond to `uci`
    const uci = spawnSync(bin, [], { input: "uci\nquit\n", stdio: "pipe" });
    return /Stockfish/i.test(String(uci.stdout));
  }
  return true;
}

const candidates = [
  process.env.STOCKFISH_PATH,
  "stockfish",
  path.join(enginesDir, "stockfish"),
].filter(Boolean);

for (const c of candidates) {
  if (existsSync(c) || has(c)) {
    console.log(`✓ Stockfish found: ${c}`);
    process.exit(0);
  }
}

if (platform() === "darwin") {
  console.log("Installing Stockfish via Homebrew…");
  const r = spawnSync("brew", ["install", "stockfish"], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

if (platform() === "linux" && arch() === "x64") {
  mkdirSync(enginesDir, { recursive: true });
  const url =
    "https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-ubuntu-x86-64-avx2.tar";
  console.log(`Downloading ${url} …`);
  const dl = spawnSync("curl", ["-L", "-o", "/tmp/stockfish.tar", url], { stdio: "inherit" });
  if (dl.status === 0) {
    const ex = spawnSync("tar", ["-xf", "/tmp/stockfish.tar", "-C", enginesDir], { stdio: "inherit" });
    if (ex.status === 0) {
      const bin = path.join(enginesDir, "stockfish");
      if (existsSync(bin)) {
        chmodSync(bin, 0o755);
        console.log(`✓ Installed to ${bin}`);
        console.log("  Add to .env.local: STOCKFISH_PATH=" + bin);
        process.exit(0);
      }
    }
  }
}

console.error(
  "Could not locate or install Stockfish. Install it yourself and set STOCKFISH_PATH."
);
process.exit(1);
