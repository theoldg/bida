#!/usr/bin/env node
/**
 * `pnpm verify [name…]` — the browser checks, against one real build: every
 * one at once, or only the ones named (`pnpm verify nav`).
 *
 * The checks `pnpm check` can't afford: run in series they take minutes, so
 * GitHub runs them at every push (docs/testing.md#where-each-check-runs).
 * Together they cost the slowest one; GitHub runs them one at a time.
 *
 * **A check is a file in `scripts/checks/`**, named for what it checks; this
 * finds them there, so adding one is adding the file.
 *
 * Each serves on port 0 with its own browser, so the only race is the build:
 * ten `ensureBuild()`s finding `out/` stale at once would run ten `next
 * build`s over each other. So the build happens here, once, first.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { ROOT, ensureBuild } from "./lib/harness.mjs";
import { annotation, runTogether } from "./lib/together.mjs";

/**
 * The slow ones first, so a capped run starts them before the queue forms;
 * the rest follow in name order. Only an ordering hint — a check missing here
 * still runs.
 */
const SLOW = ["entries", "homescreen", "offline", "stall", "nav", "demo"];
const rank = (name) => (SLOW.includes(name) ? SLOW.indexOf(name) : SLOW.length);
const ALL = readdirSync(join(ROOT, "scripts/checks"))
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => f.slice(0, -4))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

/**
 * How many chromiums at once. Each check wants about a core; ten on a
 * four-core cloud container starve the pages past the app's own timers, which
 * is where this suite's flakes came from (docs/browser-checks.md#gotchas). A laptop
 * with the cores runs them all together, as before. `VERIFY_JOBS` overrides.
 */
const LIMIT = Number(process.env.VERIFY_JOBS) || Math.max(2, availableParallelism());

/**
 * `--retry` (the deploy workflow's): a check that fails runs once more, alone.
 * Failing alone is a real failure and fails the run; passing alone is a check
 * that bets on the machine's speed — still a bug (docs/browser-checks.md#gotchas),
 * but not the pusher's to chase mid-task, so it is pinned to the run as a
 * warning, which `pnpm push` prints, and the run stays green.
 */
const RETRY = process.argv.includes("--retry");

const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const unknown = named.filter((n) => !ALL.includes(n));
if (unknown.length) {
  console.error(`verify: no check called ${unknown.join(", ")} — there are ${ALL.join(", ")}`);
  process.exit(1);
}

ensureBuild();

const file = (name) => join("scripts/checks", `${name}.mjs`);

// One check is someone working on it: let it talk as it goes, every pass
// included, rather than holding its output for a verdict.
if (named.length === 1) {
  process.exit(spawnSync("node", [file(named[0])], { cwd: ROOT, stdio: "inherit" }).status ?? 1);
}

const job = (name) => ({
  name,
  run: ["node", file(name)],
  rerun: `pnpm verify ${name}`,
  // What the harness's own reporter tallied. It prints the failures and not
  // the passes, so count the passes here — a check that asserted nothing at
  // all is the failure this would otherwise hide.
  digest: (out) => [`${(out.match(/^  ok  /gm) ?? []).length} assertions`],
});

const chosen = named.length ? ALL.filter((n) => named.includes(n)) : ALL;
const failed = await runTogether("verify", chosen.map(job), { limit: LIMIT, annotate: !RETRY });
if (!failed.length || !RETRY) process.exit(failed.length ? 1 : 0);

console.log("\nverify: trying each failure once more, alone\n");
const still = await runTogether("retry", failed.map((f) => job(f.name)), { limit: 1 });
for (const flaky of failed.filter((f) => !still.some((s) => s.name === f.name))) {
  annotation("warning", `flaky: ${flaky.name} failed beside the others and passed alone`, flaky.output);
}
process.exit(still.length ? 1 : 0);
