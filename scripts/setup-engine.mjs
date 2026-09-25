#!/usr/bin/env node
/**
 * Install a pinned Stockfish, for local development and for the Docker image.
 *
 *   pnpm run setup:engine            # install the pinned build for this machine
 *   pnpm run setup:engine --check    # verify whatever is already installed
 *   pnpm run setup:engine --print-url
 *
 * Why this script is shaped the way it is:
 *
 *  * **The version is pinned in exactly one place** (`STOCKFISH` below). Updating
 *    Stockfish is a one-line change plus a checksum, not an archaeology exercise.
 *    The previous version pointed at
 *    `releases/latest/download/stockfish-ubuntu-x86-64-avx2.tar`, which upstream
 *    renamed — it had been returning 404, and because `curl` without `-f` exits 0
 *    on a 404 the old script reported success while installing nothing.
 *  * **The download is checksummed.** `releases/latest` is a moving target, and an
 *    unpinned engine makes two deploys of the same commit behave differently.
 *  * **The binary is located, not guessed at.** The tarball is nested
 *    (`stockfish/stockfish-<platform>-universal`) and the binary is *not* named
 *    `stockfish`, so an `existsSync('engines/stockfish')` check is satisfied by the
 *    extracted *directory* and proves nothing at all.
 *  * **Success is proven by running it** and waiting for `uciok`. A file that
 *    exists is not an engine.
 *
 * An engine that already works is never replaced: `STOCKFISH_PATH`, then
 * `stockfish` on PATH (so Homebrew users are left alone), then our own install.
 *
 * See `docs/updating-stockfish.md` for the update procedure.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const enginesDir = path.join(root, "engines");
const target = path.join(enginesDir, "stockfish");

// ---------------------------------------------------------------------------
// The pinned release.
//
// To update: change `version`, run the installer, and paste the SHA256 it prints
// into the matching entry below. See docs/updating-stockfish.md.
// ---------------------------------------------------------------------------
const STOCKFISH = {
  version: "sf_19",
  display: "Stockfish 19",
  base: "https://github.com/official-stockfish/Stockfish/releases/download",
  // Both Linux targets are checksum-pinned, because those are what the container
  // runs. The macOS entries verify by running the binary instead: a Mac developer
  // normally already has Stockfish on PATH (Homebrew), which this script never
  // replaces, so the download path is rarely used there.
  assets: {
    "linux-x64": {
      file: "stockfish-linux-x86-64-universal.tar.gz",
      binary: "stockfish-linux-x86-64-universal",
      sha256: "9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f",
    },
    "linux-arm64": {
      file: "stockfish-linux-arm64-universal.tar.gz",
      binary: "stockfish-linux-arm64-universal",
      sha256: "fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01",
    },
    "darwin-arm64": {
      file: "stockfish-macos-universal.tar.gz",
      binary: "stockfish-macos-universal",
      sha256: null,
    },
    "darwin-x64": {
      file: "stockfish-macos-universal.tar.gz",
      binary: "stockfish-macos-universal",
      sha256: null,
    },
  },
};

const args = new Set(process.argv.slice(2));
const flag = (name) => args.has(`--${name}`);

function assetForThisMachine() {
  const key = `${process.platform}-${process.arch}`;
  const asset = STOCKFISH.assets[key];
  if (!asset) {
    throw new Error(
      `No pinned Stockfish build for ${key}. Supported: ${Object.keys(STOCKFISH.assets).join(", ")}. ` +
        `Install Stockfish yourself and set STOCKFISH_PATH to it.`
    );
  }
  return { key, asset, url: `${STOCKFISH.base}/${STOCKFISH.version}/${asset.file}` };
}

/** Send `uci` to a binary and wait for `uciok`. Returns its version, or null. */
function probeBinary(bin) {
  let result;
  try {
    result = spawnSync(bin, [], { input: "uci\nquit\n", encoding: "utf8", timeout: 20_000 });
  } catch {
    return null;
  }
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!out.includes("uciok")) return null;
  return out.match(/^id name (.+)$/m)?.[1]?.trim() ?? "unknown version";
}

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Every regular file under `dir` named `stockfish` or `stockfish-*`. */
function findStockfishBinaries(dir) {
  const found = [];
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/^stockfish(-|$)/i.test(entry.name)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Report on a candidate binary. Returns true when it is a working engine. */
function check(bin, label) {
  if (!fs.existsSync(bin)) return false;
  let stat;
  try {
    stat = fs.statSync(bin);
  } catch {
    return false;
  }
  if (!stat.isFile()) {
    console.error(`✗ ${label} is a directory, not a binary: ${bin}`);
    return false;
  }
  const version = probeBinary(bin);
  if (!version) {
    console.error(`✗ ${label} did not answer "uci" with "uciok": ${bin}`);
    return false;
  }
  console.log(`✓ ${label}: ${version} (${bin})`);
  return true;
}

// ---------------------------------------------------------------------------
// --print-url: useful in a Dockerfile or when debugging a failed download.
// ---------------------------------------------------------------------------
if (flag("print-url")) {
  const { url, asset } = assetForThisMachine();
  console.log(url);
  console.log(`sha256: ${asset.sha256 ?? "(not recorded — run the installer to compute it)"}`);
  process.exit(0);
}

const candidates = [
  process.env.STOCKFISH_PATH && { bin: process.env.STOCKFISH_PATH, label: "STOCKFISH_PATH" },
  { bin: "stockfish", label: "stockfish on PATH" },
  { bin: target, label: "installed engine" },
].filter(Boolean);

// ---------------------------------------------------------------------------
// --check: verify what is already there, install nothing.
// ---------------------------------------------------------------------------
if (flag("check")) {
  let ok = false;
  for (const candidate of candidates) {
    if (candidate.label === "stockfish on PATH") {
      const version = probeBinary("stockfish");
      if (version) {
        console.log(`✓ stockfish on PATH: ${version}`);
        ok = true;
      }
      continue;
    }
    ok = check(candidate.bin, candidate.label) || ok;
  }
  if (!ok) {
    console.error("\n✗ No working Stockfish found. Run: pnpm run setup:engine");
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Prefer an engine that already works.
// ---------------------------------------------------------------------------
for (const candidate of candidates) {
  if (candidate.label === "stockfish on PATH") {
    const version = probeBinary("stockfish");
    if (version) {
      console.log(`✓ Stockfish already available on PATH (${version}) — nothing to do.`);
      console.log(`  The pinned version for reference is ${STOCKFISH.display}.`);
      process.exit(0);
    }
    continue;
  }
  if (check(candidate.bin, candidate.label)) {
    console.log("Nothing to do.");
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Install the pinned build.
// ---------------------------------------------------------------------------
const { key, asset, url } = assetForThisMachine();
console.log(`Installing ${STOCKFISH.display} for ${key}`);
console.log(`  ${url}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "chessdad-sf-"));
const archive = path.join(work, asset.file);

try {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Download failed: HTTP ${res.status} ${res.statusText}.\n` +
        `  Upstream may have renamed the asset again. Check what actually exists at\n` +
        `  https://github.com/official-stockfish/Stockfish/releases/tag/${STOCKFISH.version}\n` +
        `  then update STOCKFISH.assets in this script.`
    );
  }

  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  console.log(`  downloaded ${(fs.statSync(archive).size / 1048576).toFixed(1)} MB`);

  const digest = sha256(archive);
  if (asset.sha256 && digest !== asset.sha256) {
    throw new Error(
      `Checksum mismatch — refusing to install.\n  expected ${asset.sha256}\n  actual   ${digest}\n` +
        `  Either the release was re-cut, or this is not the file you think it is.`
    );
  }
  if (asset.sha256) {
    console.log("  sha256 verified");
  } else if (flag("accept-new-checksum")) {
    console.log(`  sha256 ${digest}  (not recorded — accepting)`);
  } else {
    console.log(`  sha256 ${digest}`);
    throw new Error(
      `No checksum is recorded for ${key}, so this download cannot be verified.\n` +
        `  If you trust it, record the digest above as STOCKFISH.assets["${key}"].sha256 and re-run.\n` +
        `  Or re-run with --accept-new-checksum to install once without pinning it.`
    );
  }

  // Extract to scratch space, then fish out the real binary. Extracting straight
  // into `engines/` would collide, because the archive's top level is itself named
  // `stockfish` — the very name we want for the file.
  const extract = path.join(work, "x");
  fs.mkdirSync(extract, { recursive: true });
  const untar = spawnSync("tar", ["-xzf", archive, "-C", extract], { encoding: "utf8" });
  if (untar.status !== 0) {
    throw new Error(`Could not extract the archive: ${untar.stderr || untar.status}`);
  }

  const found = findStockfishBinaries(extract);
  if (found.length === 0) throw new Error("No Stockfish binary found inside the archive.");
  const chosen =
    found.find((f) => path.basename(f) === asset.binary) ??
    found.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

  fs.mkdirSync(enginesDir, { recursive: true });
  // `recursive: true` also clears the directory the old script used to leave here.
  fs.rmSync(target, { recursive: true, force: true });
  fs.copyFileSync(chosen, target);
  fs.chmodSync(target, 0o755);

  // GPLv3: ship the licence beside the binary we are distributing.
  const licence = path.join(extract, "stockfish", "Copying.txt");
  if (fs.existsSync(licence)) {
    fs.copyFileSync(licence, path.join(enginesDir, "Stockfish-Copying.txt"));
  }

  // Prove it runs. A file that exists is not an engine.
  const version = probeBinary(target);
  if (!version) {
    fs.rmSync(target, { force: true });
    throw new Error("The downloaded binary did not answer \"uci\" with \"uciok\" — removed it.");
  }

  console.log(`\n✓ ${version} installed at engines/stockfish`);
  console.log("  Add to .env.local (or export it):");
  console.log(`    STOCKFISH_PATH=${target}\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
