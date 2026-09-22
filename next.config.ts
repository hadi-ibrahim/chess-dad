import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only native modules (node:sqlite, child_process) run in the default
  // Node.js runtime. No cacheComponents — data pages are request-time dynamic.
};

export default nextConfig;
