import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only native modules (node:sqlite, child_process) run in the default
  // Node.js runtime. No cacheComponents — data pages are request-time dynamic.

  // Emit a self-contained server for the Docker image. `.next/standalone`
  // contains server.js plus only the node_modules Next actually traced, which
  // is what keeps the runtime image (~170 MB, engine included) from carrying
  // the whole pnpm tree (~694 MB).
  //
  // Note: standalone output does NOT copy `public/` or non-imported files, so
  // the Dockerfile copies `public/` and `okf/` (read at runtime as
  // process.cwd()/okf) explicitly.
  output: "standalone",
};

export default nextConfig;
