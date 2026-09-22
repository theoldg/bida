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
import { ensureBuild } from "./lib/harness.mjs";
import { runTogether } from "./lib/together.mjs";

/** Every `*-check.mjs`, by the `pnpm <name>` that runs it alone. */
const CHECKS = ["entries", "offline", "claim", "keyboard", "stall", "homescreen", "demo", "nav", "tricount"];

ensureBuild();

const failed = await runTogether("verify", CHECKS.map((name) => ({
  name,
  run: ["node", `scripts/${name}-check.mjs`],
  rerun: `pnpm ${name}`,
  // What the harness's own reporter tallied. It prints the failures and not
  // the passes, so count the passes here — a check that asserted nothing at
  // all is the failure this would otherwise hide.
  digest: (out) => [`${(out.match(/^  ok  /gm) ?? []).length} assertions`],
})));

process.exit(failed.length ? 1 : 0);
