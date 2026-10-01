#!/usr/bin/env node
/**
 * `node scripts/release-gate.mjs <sha>` — may this commit reach `main`?
 *
 * Only if the run its push to `dev` started is green: every job, the deploy
 * gate and the browser checks beside it (.github/workflows/deploy.yml). Still
 * running → wait for it. Anything but `success` → refuse: a failed job, and
 * equally a cancelled one, since a check that never finished has passed
 * nothing. A re-run that went green counts.
 *
 * Both release paths call it — `pnpm release` and the Actions button — so
 * production only ever gets a commit dev has already passed whole
 * (docs/hosting.md#dev-and-production).
 */
import { report, watch } from "./lib/runs.mjs";

const sha = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
  console.error("usage: node scripts/release-gate.mjs <full sha>");
  process.exit(1);
}

const jobs = await watch(sha, "gate");
report(jobs);
const short = sha.slice(0, 7);
const unfinished = jobs.filter((j) => j.conclusion !== "success");
if (unfinished.length) {
  console.error(`\ngate: refused — ${short} is not green on dev (${unfinished.map((j) => `${j.name}: ${j.conclusion}`).join(", ")}).`
    + "\n      Fix it on dev and release the fix, or re-run the run if it never got to finish.");
  process.exit(1);
}
console.log(`\ngate: ${short} is green on dev`);
