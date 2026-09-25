/**
 * A module-resolution hook so `node --test` can import the app's source directly.
 *
 * TypeScript allows `./config` and `@/lib/db`; Node's ESM resolver does not. This
 * teaches it the two tricks the bundler already performs, and nothing else:
 *
 *   * an extensionless relative or `@/` specifier resolves to `.ts`, `.tsx`, `.js`
 *     or a directory `index.*`;
 *   * `@/…` is rooted at `src/`.
 *
 * It is deliberately tiny and dependency-free, and it only ever *adds* a
 * resolution — anything it cannot place is handed back to Node unchanged.
 *
 * Note: type stripping handles `.ts` but not JSX, so this covers `src/lib` and
 * `src/app/api` logic. React components are tested through the build instead.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The first real file that `base` could mean, or null. */
function resolveFile(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (isFile(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let spec = specifier;

  // `@/lib/db` → <root>/src/lib/db
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(root, "src", spec.slice(2))).href;
  }

  const isRelative = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file:");
  if (isRelative) {
    const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : root;
    const base = spec.startsWith("file:") ? fileURLToPath(spec) : path.resolve(parent, spec);
    // Only step in when Node would otherwise fail to find the file.
    if (!path.extname(base)) {
      const resolved = resolveFile(base);
      if (resolved) return next(pathToFileURL(resolved).href, context);
    }
  }

  return next(spec, context);
}
