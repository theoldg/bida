#!/usr/bin/env node
/**
 * `pnpm verify` — every browser check, against one real build, at once.
 *
 * The checks `pnpm check` can't afford: run in series they take minutes, and
 * with nothing gating them only cheapness keeps them run (docs/testing.md).
 * Together they cost the slowest one.
 *
 * Each serves on port 0 with its own browser, so the only race is the build:
 * six `ensureBuild()`s finding `out/` stale at once would run six `next
 * build`s over each other. So the build happens here, once, first.
 */
import { availableParallelism } from "node:os";
import { ensureBuild } from "./lib/harness.mjs";
import { annotation, runTogether } from "./lib/together.mjs";

/**
 * Every `*-check.mjs`, by the `pnpm <name>` that runs it alone — slowest
 * first, so a capped run starts the long ones before the queue forms.
 */
const CHECKS = ["entries", "homescreen", "offline", "stall", "nav", "demo", "claim", "keyboard", "tricount", "driver"];

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

ensureBuild();

const job = (name) => ({
  name,
  run: ["node", `scripts/${name}-check.mjs`],
  rerun: `pnpm ${name}`,
  // What the harness's own reporter tallied. It prints the failures and not
  // the passes, so count the passes here — a check that asserted nothing at
  // all is the failure this would otherwise hide.
  digest: (out) => [`${(out.match(/^  ok  /gm) ?? []).length} assertions`],
});

const failed = await runTogether("verify", CHECKS.map(job), { limit: LIMIT, annotate: !RETRY });
if (!failed.length || !RETRY) process.exit(failed.length ? 1 : 0);

console.log("\nverify: trying each failure once more, alone\n");
const still = await runTogether("retry", failed.map((f) => job(f.name)), { limit: 1 });
for (const flaky of failed.filter((f) => !still.some((s) => s.name === f.name))) {
  annotation("warning", `flaky: ${flaky.name} failed beside the others and passed alone`, flaky.output);
}
process.exit(still.length ? 1 : 0);
