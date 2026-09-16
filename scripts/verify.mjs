#!/usr/bin/env node
/**
 * `pnpm verify` — every browser check, against one real build, at once.
 *
 * These are the checks `pnpm check` cannot afford: they drive the built app in
 * a real browser, and run one after another they cost two minutes. Nothing
 * gates them, so the only thing keeping them honest is how cheap they are to
 * run — and two minutes is not cheap enough, which is how three of them came to
 * sit red for weeks (docs/testing.md). Together they cost the slowest one.
 *
 * They share nothing to collide over: each serves the export on port 0 and
 * drives its own browser. The one thing they would have raced on is the
 * build — six `ensureBuild()`s deciding at the same moment that `out/` is
 * stale, and six `next build`s writing over each other. So the build happens
 * here, once, before any of them starts; each then finds it current and skips
 * it.
 */
import { ensureBuild } from "./lib/harness.mjs";
import { runTogether } from "./lib/together.mjs";

/** Every `*-check.mjs`, by the `pnpm <name>` that runs it alone. */
const CHECKS = ["entries", "offline", "claim", "keyboard", "stall", "homescreen"];

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
