/**
 * Test bootstrap: installs the resolver hook before any test imports the source.
 *
 * Used as `node --import ./test/setup.mjs --test`. The `react-server` condition
 * (passed on the command line) makes the `server-only` marker package resolve to
 * its empty build, which is how these modules are loaded on the server — without
 * it, importing anything in `src/lib` throws by design.
 */
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
