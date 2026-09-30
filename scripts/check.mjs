#!/usr/bin/env node
/**
 * `pnpm check` — the fast gate. Doc links, the rules the docs state, the
 * version against what dev is serving, typecheck and tests, all at once
 * (scripts/lib/together.mjs), in under half a minute.
 *
 * Run by `pre-push` on the machine making the push, and again (`--ci`) by the
 * deploy workflow in front of the build — which is the one gate that lives
 * only there: a build that fails in CI deploys nothing, and `pnpm push` says
 * so (docs/testing.md). A pass is stamped against its tree, so a rerun over
 * the same tree exits at once.
 *
 * Adding a stage: a line in STAGES — if it would otherwise fail on `main`
 * uncaught, and it takes seconds. What takes minutes runs on GitHub
 * (.github/workflows/deploy.yml).
 */
import { runTogether } from "./lib/together.mjs";
import { fingerprint, stampMatches, writeStamp } from "./lib/check-stamp.mjs";

const CI = process.argv.includes("--ci");

const STAGES = [
  { name: "docs", run: ["node", "scripts/docs-check.mjs"], rerun: "pnpm run docs" },
  { name: "rules", run: ["node", "scripts/rules-check.mjs"], rerun: "pnpm run rules" },
  // The one stage CI cannot run: it clones shallow and has no `dev` to compare
  // against, and the number has to be in the commit being pushed, not added
  // after (scripts/version.mjs).
  ...(CI ? [] : [{ name: "version", run: ["node", "scripts/version.mjs", "--check"], rerun: "pnpm bump" }]),
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
];

// Taken before anything runs, so what gets stamped is the tree that passed.
// CI starts from a fresh clone every time, so it has nothing to remember.
const tree = CI ? null : fingerprint();
const passed = tree && !process.argv.includes("--force") ? stampMatches(tree) : null;
if (passed) {
  console.log(`check  this tree passed ${passed} and has not changed since — nothing to do`);
  console.log("       (`pnpm check --force` runs it anyway)");
  process.exit(0);
}

const failed = await runTogether("check", STAGES);
if (!failed.length && tree) writeStamp(tree);
process.exit(failed.length ? 1 : 0);
