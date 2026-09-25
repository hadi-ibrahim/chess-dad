# Chess Dad — production image (Railway, or any Docker host).
#
#   docker build -t chessdad .
#   docker run --rm -p 3000:3000 -v chessdad-data:/data chessdad
#
# ===========================================================================
# Pinned versions, and why
# ===========================================================================
#
# Node 22.21.1 on Debian Bookworm slim (also pinned in .nvmrc).
#   The whole data layer is `node:sqlite`, which only exists from Node 22.13 —
#   so the Node major is load-bearing here, not incidental. 22.21.1 is the
#   version the project is developed against.
#
# Stockfish 19 — GitHub release tag `sf_19`.
#   Upstream : https://github.com/official-stockfish/Stockfish/releases/tag/sf_19
#   Download : https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz
#              https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-arm64-universal.tar.gz
#   Both URLs were confirmed HTTP 200 with
#     curl -sIL -o /dev/null -w '%{http_code}' <url>
#   and the tarballs are verified by SHA-256 below, so a moved/renamed asset
#   fails the build instead of silently shipping a different engine.
#
#   Asset naming has changed across releases — do not "simplify" this back to a
#   `releases/latest/download/...` URL:
#     * `.../releases/latest/download/stockfish-ubuntu-x86-64-avx2.tar`
#       (what scripts/setup-engine.mjs still uses) is a hard 404: `latest`
#       resolves to tag sf_19, which no longer publishes `stockfish-ubuntu-*`.
#       The last release that did was sf_18.
#     * sf_19 publishes `stockfish-linux-<arch>-universal.tar.gz` instead.
#   We pin the explicit tag `sf_19`, never `latest`, so the build is
#   reproducible; the SHA-256 is the real guarantee, since a tag can be moved.
#
#   The "universal" builds select CPU features at runtime, so unlike the old
#   `-avx2` assets they do not require an AVX2-capable host. Railway is amd64;
#   the arm64 branch exists so the image also builds and can be smoke-tested
#   natively on Apple Silicon.
#
#   The release tarball is NESTED — the binary is not at the archive root and is
#   not named `stockfish`:
#     stockfish/Copying.txt
#     stockfish/stockfish-linux-x86-64-universal   (or -arm64-universal)
#   ...so it is installed as /app/engines/stockfish (STOCKFISH_PATH) below.
#
#   SHA-256 of the tarballs:
#     amd64  9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f
#     arm64  fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01
#
# ===========================================================================
# GPLv3 obligation — shipping Stockfish means DISTRIBUTING it
# ===========================================================================
# Stockfish is GPLv3. Baking the binary into this image is distribution, so the
# license text and a pointer to the exact corresponding source must travel with
# it. The release tarball ships `Copying.txt`; it is copied into the image as
#   /app/engines/Stockfish-Copying.txt   (verbatim GPLv3 text)
#   /app/engines/Stockfish-SOURCE.txt    (release tag + source/download URLs)
# Chess Dad itself is MIT and does not link against Stockfish — it spawns it as a
# separate process and speaks the documented UCI protocol (src/lib/engine.ts).
# ===========================================================================

ARG NODE_VERSION=22.21.1

# ---------------------------------------------------------------------------
# Stage 1 — engines: download, checksum-verify and smoke-test Stockfish
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS engines

ARG STOCKFISH_TAG=sf_19
ARG STOCKFISH_AMD64_SHA256=9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f
ARG STOCKFISH_ARM64_SHA256=fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01

# curl + TLS roots to fetch, tar to unpack. These stay in this stage only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tar \
 && rm -rf /var/lib/apt/lists/*

# The architecture is read from the image itself (`dpkg --print-architecture`),
# NOT from BuildKit's TARGETARCH. Re-declaring `ARG TARGETARCH` inside a stage
# with a default value shadows the automatic platform arg, and the build then
# silently installs the amd64 binary into an arm64 image. `dpkg` describes the
# container we are actually running in, so the smoke test below always executes
# a binary built for this image.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "${arch}" in \
      amd64) asset="stockfish-linux-x86-64-universal.tar.gz"; sha="${STOCKFISH_AMD64_SHA256}"; member="stockfish-linux-x86-64-universal" ;; \
      arm64) asset="stockfish-linux-arm64-universal.tar.gz"; sha="${STOCKFISH_ARM64_SHA256}"; member="stockfish-linux-arm64-universal" ;; \
      *) echo "unsupported architecture '${arch}'" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_TAG}/${asset}"; \
    echo "Downloading ${url}"; \
    curl -fsSL --retry 3 --retry-delay 2 -o /tmp/stockfish.tar.gz "${url}"; \
    echo "${sha}  /tmp/stockfish.tar.gz" | sha256sum -c -; \
    mkdir -p /tmp/sf /out; \
    tar -xzf /tmp/stockfish.tar.gz -C /tmp/sf; \
    install -m 0755 "/tmp/sf/stockfish/${member}" /out/stockfish; \
    install -m 0644 /tmp/sf/stockfish/Copying.txt /out/Stockfish-Copying.txt; \
    printf 'Stockfish %s\nDownload: %s\nCorresponding source: https://github.com/official-stockfish/Stockfish/tree/%s\nLicense: GPLv3 (see Stockfish-Copying.txt)\n' \
      "${STOCKFISH_TAG}" "${url}" "${STOCKFISH_TAG}" > /out/Stockfish-SOURCE.txt; \
    rm -rf /tmp/stockfish.tar.gz /tmp/sf

# Fail the build loudly if the binary cannot start and speak UCI. A silently
# broken engine is the failure mode this image must not have: /api/health
# spawns Stockfish and waits for `uciok`, so a bad binary means 503 forever.
RUN printf 'uci\nquit\n' | /out/stockfish | grep -q '^uciok'

# ---------------------------------------------------------------------------
# Stage 2 — deps: install the frozen pnpm dependency tree
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1

# Pinned to the exact `packageManager` version in package.json.
RUN npm install --global pnpm@11.22.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3 — build: Next.js production build with output: "standalone"
# ---------------------------------------------------------------------------
FROM deps AS build

COPY . .

# The dev database is excluded by .dockerignore; point any accidental open
# during the build at a throwaway path rather than at a real library.
ENV CHESSDAD_DB_PATH=/tmp/build/chessdad.db \
    CHESSDAD_DATA_DIR=/tmp/build

RUN pnpm build

# If standalone output ever stops being produced the image would ship an empty
# /app, so assert the artefacts here instead of at runtime.
RUN test -f .next/standalone/server.js && test -d .next/static

# ---------------------------------------------------------------------------
# Stage 4 — runtime: the standalone server, the tracing-trimmed node_modules,
#           the OKF bundle, the pinned engine, as a non-root user
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# Conservative defaults for a small container. Railway overrides PORT; every
# value can be overridden by a platform env var.
# The defaults above keep derived paths on the volume too: the backup scheduler
# writes to `${CHESSDAD_DATA_DIR:-cwd/data}/backups` (src/lib/backup.ts), so
# without CHESSDAD_DATA_DIR=/data it would try to write /app/data/backups —
# outside the volume and not writable by the non-root user.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHESSDAD_DB_PATH=/data/chessdad.db \
    CHESSDAD_DATA_DIR=/data \
    STOCKFISH_PATH=/app/engines/stockfish \
    WORKER_CONCURRENCY=1 \
    ENGINE_POOL_SIZE=2 \
    ENGINE_HASH_MB=32 \
    ENGINE_THREADS=2 \
    ANALYSIS_DEPTH=14

# No LLM provider env any more: AI providers (and their keys) belong to a user's
# browser profile, so the image ships with no model, key or spend of its own.

# ca-certificates: the app makes outbound HTTPS calls to the Lichess and
# Chess.com APIs, and the node:*-slim image does not ship a CA bundle.
# setpriv (util-linux) is already present and is what the entrypoint uses to
# drop root — no extra privilege-dropping binary is installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# output: "standalone" emits server.js plus only the node_modules Next traced,
# which is the difference between a ~200 MB image and a ~700 MB one.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Next serves public/ itself, but standalone output does not include it.
COPY --from=build /app/public ./public

# The OKF knowledge base is read at runtime as a plain filesystem read of
# process.cwd()/okf (src/lib/config.ts, src/lib/okf.ts). It is not a traced
# import, so standalone output silently omits it — copy it explicitly.
COPY --from=build /app/okf ./okf

# Pinned engine, GPLv3 license text, and the source pointer (see header).
# --chown here, rather than a later `chown -R`, is deliberate: re-owning the
# 100 MB binary in a separate layer copies the whole file again and adds ~103 MB
# to the image.
COPY --chown=node:node --from=engines /out/stockfish ./engines/stockfish
COPY --chown=node:node --from=engines /out/Stockfish-Copying.txt ./engines/Stockfish-Copying.txt
COPY --chown=node:node --from=engines /out/Stockfish-SOURCE.txt ./engines/Stockfish-SOURCE.txt

# /data is the persistent-volume mount point. Railway mounts the volume owned by
# root, which the non-root app user cannot write, so the entrypoint repairs
# ownership before dropping privileges. Written inline (via printf) to keep the
# repository to the five deployment files.
RUN mkdir -p /data \
 && chown node:node /data \
 && printf '%s\n' \
      '#!/bin/sh' \
      'set -e' \
      'if [ "$(id -u)" = "0" ]; then' \
      '  db_dir="$(dirname "${CHESSDAD_DB_PATH:-/data/chessdad.db}")"' \
      '  mkdir -p "$db_dir"' \
      '  chown node:node "$db_dir" 2>/dev/null || true' \
      '  exec setpriv --reuid=node --regid=node --init-groups -- "$@"' \
      'fi' \
      'exec "$@"' \
      > /usr/local/bin/docker-entrypoint.sh \
 && chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# The real readiness endpoint: 200 only when the database is usable, Stockfish
# answers `uciok`, disk is not full and the worker is not stuck — exactly the
# conditions under which analyses can run. A container that cannot analyse is
# unhealthy, which is what makes a bad deploy roll back.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only long enough to make the volume writable, then execs the
# server as `node` (uid 1000). The app process is never root.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
