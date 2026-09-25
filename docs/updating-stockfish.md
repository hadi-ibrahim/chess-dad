# Updating Stockfish

Stockfish is the app's only evaluator. The version is **pinned in exactly one
place**, and updating it is deliberately a two-minute job.

## Where the version lives

`scripts/setup-engine.mjs`, in the `STOCKFISH` constant near the top:

```js
const STOCKFISH = {
  version: "sf_19",
  display: "Stockfish 19",
  base: "https://github.com/official-stockfish/Stockfish/releases/download",
  assets: {
    "linux-x64": {
      file: "stockfish-linux-x86-64-universal.tar.gz",
      binary: "stockfish-linux-x86-64-universal",
      sha256: "9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f",
    },
    "linux-arm64": { /* checksummed too — both Linux targets are pinned */ },
    // darwin-arm64, darwin-x64: verified by running, not by checksum
  },
};
```

Both Linux targets are checksum-pinned, because those are what the container runs.
A Mac developer normally already has Stockfish on PATH (Homebrew), which the
installer never replaces, so the macOS download path is rarely exercised — those
entries verify by running the binary and report the digest to record.

```

Everything else derives from it: the URL is
`<base>/<version>/<file>`, and the Docker image runs this same script, so the
container and a developer's laptop get the identical engine.

## To update

1. Find the new tag and asset names — **do not guess them**:

   ```bash
   curl -s https://api.github.com/repos/official-stockfish/Stockfish/releases/latest \
     | grep -E '"tag_name"|"name"' | head -20
   ```

   Upstream has renamed its assets before (the old `-ubuntu-*-avx2.tar` files
   became `-linux-*-universal.tar.gz` at `sf_17`), which is exactly how the
   previous installer silently rotted into a 404.

2. Change `version` (and `display`), and update each `file`/`binary` if the names
   changed.

3. Delete the `sha256` you are replacing — or simply run the installer, which
   **refuses to install an unverified download** and prints the digest it
   computed:

   ```bash
   pnpm run setup:engine
   #   sha256 4b1c…  (not recorded — …)
   #   Error: No checksum is recorded for linux-x64 …
   ```

4. Paste that digest into the matching `sha256` and run it again.

5. Confirm the engine actually answers:

   ```bash
   pnpm run verify:engine          # spawns it and waits for `uciok`
   ```

6. Rebuild the image and roll it out. `GET /api/health` reports the engine version
   and fails with `503` if Stockfish will not start, so a bad engine cannot be
   promoted silently.

## Why it is built this way

The previous installer had three defects, all of which made a broken engine look
fine:

- **A dead URL.** It pointed at a `releases/latest` asset name that no longer
  existed. Because `curl` without `-f` exits `0` on a `404`, the failure was
  invisible.
- **A wrong success test.** The tarball is nested — `stockfish/stockfish-<platform>-universal`
  — and the binary is not named `stockfish`. The old script extracted into
  `engines/` and then checked `existsSync('engines/stockfish')`, which was
  satisfied by the extracted *directory*. It printed "✓ Installed" while
  installing nothing usable.
- **No pinning.** `releases/latest` means two deploys of the same commit can ship
  different engines.

The current script verifies a checksum, locates the binary by inspecting the
archive, and only reports success after the binary answers `uciok`.

## Licensing

Stockfish is **GPLv3**. The app is MIT and only talks to the engine over UCI as a
separate process, so the app is not a derived work — but *distributing the binary
in a container image is distribution*, which carries GPLv3 §6 obligations. The
installer copies `Copying.txt` next to the binary, and the Dockerfile is expected
to keep it in the image. Do not remove it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Download failed: HTTP 404` | Upstream renamed the asset. Re-read the release and update `file`/`binary`. |
| `Checksum mismatch — refusing to install` | The release was re-cut, or the file is not what it claims. Investigate before overriding. |
| `did not answer "uci" with "uciok"` | The wrong file was extracted (a directory, a script, or a foreign architecture). |
| `No pinned Stockfish build for <platform>` | Unsupported platform. Install Stockfish yourself and set `STOCKFISH_PATH`. |
| Analysis jobs all time out, health says engine not ok | `STOCKFISH_PATH` is unset or wrong in the deployed environment. |
