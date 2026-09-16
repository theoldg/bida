#!/usr/bin/env node
/**
 * `pnpm check` — the gate. Doc links, the rules the docs state, typecheck,
 * tests and the static export build, all at once (scripts/lib/together.mjs).
 *
 * It is the only thing standing between an edit and production
 * (docs/testing.md), and it is also the command a session runs most: once by
 * hand, and again inside `pre-push`. The second of those is thirty seconds
 * spent proving what the first just proved, and the way that habit ends is
 * somebody reaching for `--no-verify` — so a pass is stamped against the tree
 * it passed over, and a run over that same tree says so and exits.
 *
 * Adding a stage: a line in STAGES. It belongs here if it would otherwise fail
 * on `main` with nothing to catch it, and nowhere else if it takes minutes —
 * the browser checks are `pnpm verify` for exactly that reason.
 */
import { runTogether } from "./lib/together.mjs";
import { fingerprint, stampMatches, writeStamp } from "./lib/check-stamp.mjs";

const STAGES = [
  { name: "docs", run: ["node", "scripts/docs-check.mjs"], rerun: "pnpm run docs" },
  { name: "rules", run: ["node", "scripts/rules-check.mjs"], rerun: "pnpm run rules" },
  { name: "typecheck", run: ["pnpm", "-r", "--if-present", "typecheck"], rerun: "pnpm run typecheck" },
  {
    name: "test",
    run: ["pnpm", "-r", "--if-present", "test"],
    rerun: "pnpm run test",
    // One line per package that ran. A doc may not state a test count
    // (docs-check enforces that) precisely because this says it on every run —
    // and a package whose test script got renamed away shows up as a missing
    // line rather than as a silent `--if-present` success.
    digest: (out) => [...out.matchAll(/^\s*(\S+) test:\s+(Tests\s+.*)$/gm)].map((m) => `${m[1]}  ${m[2]}`),
  },
  {
    name: "build",
    run: ["pnpm", "-r", "--if-present", "build"],
    rerun: "pnpm run build",
    digest: (out) => [...out.matchAll(/^\s*\S+ build:\s+(precache: .*)$/gm)].map((m) => m[1]),
  },
];

// Taken before anything runs, so what gets stamped is the tree that passed.
const tree = fingerprint();
const passed = process.argv.includes("--force") ? null : stampMatches(tree);
if (passed) {
  console.log(`check  this tree passed ${passed} and has not changed since — nothing to do`);
  console.log("       (`pnpm check --force` runs it anyway)");
  process.exit(0);
}

const failed = await runTogether("check", STAGES);
if (!failed.length) writeStamp(tree);
process.exit(failed.length ? 1 : 0);
