#!/usr/bin/env node
/**
 * `pnpm check` — the gate, run as five stages at once.
 *
 * This is the only thing standing between an edit and production
 * (docs/testing.md), and it is also the command a session runs most: once by
 * hand, and again inside `pre-push`. So it is worth it being both fast and
 * legible, which the plain `a && b && c` it replaces was neither:
 *
 * - **Serial cost nothing.** Nothing here reads what another stage writes —
 *   `tsc --noEmit` emits nothing, vitest builds in memory, and only the build
 *   touches `out/`. Run together they take as long as the slowest (the build),
 *   not as long as the sum: ~30s instead of ~50s on four cores.
 * - **`&&` stops at the first failure**, so a typo that breaks both the
 *   typecheck and the tests is two runs to find out. Every stage runs here,
 *   whatever the others do, and the report lists all of them.
 * - **A pass printed 60 lines of `next build` output.** Passing stages are
 *   silent now apart from a digest line; only a failure spills its output, and
 *   only the failing one's.
 *
 * Adding a stage: a line in STAGES below. `digest` is what gets printed on a
 * pass — keep it to the line a reader would have scrolled to find, and make it
 * something that is *absent* when the stage did nothing, since `--if-present`
 * turns a script that got renamed away into a silent success.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const STAGES = [
  { name: "docs", run: ["node", "scripts/docs-check.mjs"], rerun: "pnpm run docs" },
  { name: "rules", run: ["node", "scripts/rules-check.mjs"], rerun: "pnpm run rules" },
  { name: "typecheck", run: ["pnpm", "-r", "--if-present", "typecheck"], rerun: "pnpm run typecheck" },
  {
    name: "test",
    run: ["pnpm", "-r", "--if-present", "test"],
    rerun: "pnpm run test",
    // One per package that ran. A doc may not state a test count (docs-check
    // enforces that) precisely because this says it out loud on every run.
    digest: /^\s*(\S+) test:\s+(Tests\s+.*)$/gm,
  },
  {
    name: "build",
    run: ["pnpm", "-r", "--if-present", "build"],
    rerun: "pnpm run build",
    digest: /^\s*\S+ build:\s+(precache: .*)$/gm,
  },
];

const started = Date.now();
console.log(`check  ${STAGES.map((s) => s.name).join(" ")} — together\n`);

/** Run one stage to completion, keeping its output rather than printing it. */
const runStage = (stage) => new Promise((done) => {
  const at = Date.now();
  const child = spawn(stage.run[0], stage.run.slice(1), {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => { output += b; });
  child.stderr.on("data", (b) => { output += b; });
  // A missing binary never reaches 'close' with a code, so say which one.
  child.on("error", (e) => { output += `${e.message}\n`; });
  child.on("close", (code) => {
    const result = { ...stage, ok: code === 0, seconds: (Date.now() - at) / 1000, output };
    // As each finishes, so a thirty-second run is never a silent terminal.
    console.log(`${result.ok ? "  ok  " : "FAIL  "}${stage.name.padEnd(11)}${result.seconds.toFixed(1).padStart(5)}s`);
    if (result.ok) for (const m of output.matchAll(stage.digest ?? /(?!)/g)) {
      console.log(`        ${m.slice(1).filter(Boolean).join("  ")}`);
    }
    done(result);
  });
});

const results = await Promise.all(STAGES.map(runStage));
const failed = results.filter((r) => !r.ok);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

for (const stage of failed) {
  console.log(`\n──── ${stage.name} ${"─".repeat(Math.max(0, 66 - stage.name.length))}`);
  console.log(stage.output.trimEnd());
}

if (!failed.length) {
  console.log(`\nall checks passed in ${elapsed}s`);
  process.exit(0);
}
console.log(
  `\n${failed.length} of ${results.length} failed in ${elapsed}s — ` +
  failed.map((s) => `\`${s.rerun}\``).join(", ") + " on their own",
);
process.exit(1);
