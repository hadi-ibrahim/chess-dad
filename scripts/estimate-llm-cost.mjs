#!/usr/bin/env node
/**
 * Estimate what LLM coaching costs, from the real database.
 *
 *   node scripts/estimate-llm-cost.mjs
 *   node scripts/estimate-llm-cost.mjs --model deepseek-v4-pro
 *
 * The LLM is the only part of Chess Dad that costs money per use, and the answer
 * to "how much?" comes from three numbers:
 *
 *   1. **How many explanations are needed** — one per critical moment that has an
 *      engine best move. Read from the database, so it is your data, not a guess.
 *   2. **How many tokens each takes** — measured from real calls (below), because
 *      the prompt is a fixed template and the reply is capped at 2-3 sentences, so
 *      the figure is stable rather than an average over wildly varying work.
 *   3. **The price per token** — from DeepSeek's published rates.
 *
 * The cache matters more than any of them: an AI explanation is stored per
 * (position, provider, model), so a position is paid for **once per model** and
 * every later analysis of it with that model is free. The projection below only
 * charges for positions not already cached.
 *
 * Note that AI coaching is now **opt-in per profile** — the default analysis uses
 * the free, offline engine coach — so this is a projection for the users who
 * choose a provider, not a bill the operator necessarily carries.
 *
 * Pricing source: https://api-docs.deepseek.com/quick_start/pricing/
 * Verify it before trusting these numbers — rates change.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Measured, not assumed: from real calls against this app's own prompt, with
// thinking mode OFF (which is now the default — see .env.example). Re-measure
// from the `llm: call` lines in the server log.
//
// If a connection enables reasoning mode, these numbers are meaningless: reasoning
// tokens are billed as output and their length is unbounded. One measured call
// returned 24,699 reasoning tokens over 119 seconds — roughly 40x the cost below,
// and slow enough that LLM_TIMEOUT_MS aborts it and the answer is discarded.
// ---------------------------------------------------------------------------
const MEASURED = {
  promptTokens: 453, // the position, engine verdict, classification, motif, rating
  completionTokens: 179, // 2-3 sentences of explanation + lesson + drill, as JSON
  explanationsPerGame: 6.6, // measured: 33 explanations across 5 newly analysed games
};

// ---------------------------------------------------------------------------
// Published prices, USD per 1M tokens: [off-peak, peak].
// Peak is 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri. Everything else is half price.
// ---------------------------------------------------------------------------
const PRICING = {
  "deepseek-flash": { inputMiss: [0.15, 0.3], inputHit: [0.003, 0.006], output: [0.6, 1.2] },
  "deepseek-v4-pro": { inputMiss: [0.66, 1.32], inputHit: [0.022, 0.044], output: [1.98, 3.96] },
};

const args = process.argv.slice(2);
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : "deepseek-flash";
const price = PRICING[modelArg];
if (!price) {
  console.error(`Unknown model "${modelArg}". Known: ${Object.keys(PRICING).join(", ")}`);
  process.exit(2);
}

const dbPath = path.resolve(
  process.env.CHESSDAD_DB_PATH || path.join(process.cwd(), "data", "chessdad.db")
);
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

/** Critical moments that produce an explanation: flagged, with a best move. */
const eligible = db
  .prepare("SELECT COUNT(*) AS n FROM positions WHERE is_critical = 1 AND best_move IS NOT NULL")
  .get().n;
const totalPositions = db.prepare("SELECT COUNT(*) AS n FROM positions").get().n;
const games = db.prepare("SELECT COUNT(*) AS n FROM games").get().n;
const analyzed = db.prepare("SELECT SUM(analyzed) AS n FROM games").get().n ?? 0;
const cached = db.prepare("SELECT COUNT(*) AS n FROM ai_explanations").get().n;
db.close();

const remaining = Math.max(0, eligible - cached);
const tokensPerExplanation = MEASURED.promptTokens + MEASURED.completionTokens;

/** Cost in USD for `count` explanations at the given tier (0 = off-peak, 1 = peak). */
function cost(count, tier) {
  const input = (count * MEASURED.promptTokens * price.inputMiss[tier]) / 1e6;
  const output = (count * MEASURED.completionTokens * price.output[tier]) / 1e6;
  return input + output;
}

const usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

console.log(`Model            : ${modelArg}`);
console.log(`Database         : ${dbPath}`);
console.log();
console.log(`Games            : ${games} (${analyzed} analysed)`);
console.log(`Positions stored : ${totalPositions}`);
console.log(`Explanations needed: ${eligible}  (critical moments with an engine best move)`);
console.log(`Already cached   : ${cached}`);
console.log(`Still to pay for : ${remaining}`);
console.log();
console.log(
  `Measured per explanation: ~${tokensPerExplanation} tokens ` +
    `(${MEASURED.promptTokens} in / ${MEASURED.completionTokens} out)`
);
console.log();

console.log("Cost to finish THIS library");
console.log(`  off-peak : ${usd(cost(remaining, 0))}`);
console.log(`  peak     : ${usd(cost(remaining, 1))}`);
console.log();

console.log("Projection as the library grows (assumes fresh positions, nothing cached)");
console.log("  games    off-peak      peak");
for (const n of [100, 1_000, 10_000, 100_000]) {
  const explanations = n * MEASURED.explanationsPerGame;
  console.log(
    `  ${String(n).padEnd(8)} ${usd(cost(explanations, 0)).padEnd(12)} ${usd(cost(explanations, 1))}`
  );
}
console.log();
console.log(
  `Per game: about ${usd(cost(MEASURED.explanationsPerGame, 0))} off-peak / ` +
    `${usd(cost(MEASURED.explanationsPerGame, 1))} peak.`
);
console.log();
console.log("Notes:");
console.log("  * Cache hits cost ~50x less than misses, but critical moments sit deep in");
console.log("    the middlegame, so they are almost always misses.");
console.log("  * Re-analysis is free for positions already cached, which is why the");
console.log("    numbers above only charge for what is not cached yet.");
console.log("  * The default analysis uses the offline OKF coach and costs nothing;");
console.log("    this bill only applies where a profile asks a provider to re-analyse.");
