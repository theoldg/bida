#!/usr/bin/env node
/**
 * `pnpm push` — how a session ships: bump, push to `dev`, and wait for the
 * run that push started until it says green or red.
 *
 * 1. **A clean tree.** What is uncommitted is not pushed, so it is refused.
 * 2. **`dev` has not moved** under this work. If it has, this rebases onto it
 *    and **stops without pushing**: a rebase git calls clean can still be
 *    wrong (two changes that each hold alone and not together), so the agent
 *    reads what came in, checks its work against it and runs this again.
 *    A conflict is aborted and handed back the same way. The one conflict it
 *    settles itself is the version line, which every push moves.
 * 3. **The bump**, folded into the last commit — which is unpushed, or step 2
 *    would have stopped (docs/hosting.md#versions).
 * 4. **The push**, through `pre-push` (`pnpm check`). Refused because
 *    someone pushed in the same moment → back to step 2.
 * 5. **The watch.** The deploy workflow runs the fast checks again, builds and
 *    deploys, and beside it drives every browser check
 *    (.github/workflows/deploy.yml). This prints each job as it moves and ends
 *    on the verdict: the failures pinned to the run, and any flaky check.
 *
 * `pnpm push --watch [sha]` skips to step 5, for a watch that was cut off.
 * Exit 0 is green; anything else is the session's to act on
 * (docs/testing.md#where-each-check-runs).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { report, watch } from "./lib/runs.mjs";
import { ROOT } from "./lib/together.mjs";

const TARGET = "dev";
const UPSTREAM = `origin/${TARGET}`;

/** git, answering its output, or `null` for a non-zero exit. */
function git(...args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const lines = (text) => (text ? text.split("\n").filter(Boolean) : []);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const say = (text = "") => console.log(text);
function stop(code, text) {
  if (text) console.error(text);
  process.exit(code);
}

/* ---- 1–4: getting the commit onto dev ---------------------------------- */

/** Up to four more tries on a network failure, 2/4/8/16s apart (CLAUDE.md). */
async function fetchUpstream() {
  for (const wait of [0, 2, 4, 8, 16]) {
    if (wait) await sleep(wait * 1000);
    if (git("fetch", "origin", TARGET, "--quiet") !== null) return;
  }
  stop(1, `push: could not fetch ${UPSTREAM}`);
}

/**
 * A conflict that is the version line and nothing else: every push moves it,
 * so a session rebasing over another's push always meets one. `dev`'s number
 * is kept, and the bump after the rebase moves past it.
 */
function onlyTheVersion() {
  if (lines(git("diff", "--name-only", "--diff-filter=U")).join() !== "package.json") return false;
  const file = join(ROOT, "package.json");
  const text = readFileSync(file, "utf8");
  const hunk = /<<<<<<< [^\n]*\n([^\n]*)\n=======\n([^\n]*)\n>>>>>>> [^\n]*\n/g;
  const version = /^\s*"version":\s*"\d+\.\d+\.\d+",?$/;
  const hunks = [...text.matchAll(hunk)];
  const markers = (text.match(/^(<<<<<<<|=======|>>>>>>>)/gm) ?? []).length;
  if (!hunks.length || markers !== hunks.length * 3) return false;
  if (!hunks.every((h) => version.test(h[1]) && version.test(h[2]))) return false;
  // In a rebase the first side is the branch being rebased onto: `dev`'s.
  writeFileSync(file, text.replace(hunk, "$1\n"));
  return git("add", "package.json") !== null;
}

/** Rebase onto what `dev` became, say what came in, and never push after. */
function catchUp() {
  const base = git("merge-base", "HEAD", UPSTREAM);
  const incoming = lines(git("log", "--oneline", `HEAD..${UPSTREAM}`));
  say(`push: ${TARGET} has moved — ${incoming.length} commit${incoming.length === 1 ? "" : "s"} since this work started:`);
  for (const c of incoming) say(`  ${c}`);

  let ok = git("-c", "merge.conflictStyle=merge", "rebase", UPSTREAM) !== null;
  for (let i = 0; !ok && i < 100 && onlyTheVersion(); i++) {
    ok = spawnSync("git", ["-c", "core.editor=true", "rebase", "--continue"],
      { cwd: ROOT, encoding: "utf8" }).status === 0;
  }
  if (!ok) {
    const conflicted = lines(git("diff", "--name-only", "--diff-filter=U"));
    git("rebase", "--abort");
    stop(1, `\npush: the rebase onto ${UPSTREAM} conflicts${conflicted.length ? ` in ${conflicted.join(", ")}` : ""}.\n`
      + `      Nothing was pushed, and the branch is as it was. Rebase by hand, then \`pnpm push\` again.`);
  }

  const theirs = new Set(lines(git("diff", "--name-only", base, UPSTREAM)));
  const shared = lines(git("diff", "--name-only", UPSTREAM, "HEAD")).filter((f) => theirs.has(f));
  say(`\npush: rebased onto ${UPSTREAM} — and not pushed.`);
  if (shared.length) say(`      Touched on both sides: ${shared.join(", ")}`);
  stop(2, "      A clean rebase is not a checked one: read what came in against your work, run what it\n"
    + "      touches (`pnpm check`, the browser check for a screen both changed), then `pnpm push` again.");
}

/** The bump, in the last commit rather than one of its own. */
function bump() {
  const r = spawnSync("node", ["scripts/version.mjs"], { cwd: ROOT, encoding: "utf8" });
  process.stdout.write(r.stdout);
  if (r.status !== 0) stop(1, r.stderr);
  if (git("diff", "--quiet", "--", "package.json") !== null) return;
  if (git("commit", "--amend", "--no-edit", "--quiet", "--", "package.json") === null) stop(1, "push: could not fold the bump into the last commit");
}

/** `pushed`, `moved` (someone else got there first) or a failure already reported. */
async function pushOnce() {
  for (const wait of [0, 2, 4, 8, 16]) {
    if (wait) { say(`push: retrying in ${wait}s`); await sleep(wait * 1000); }
    // stdout straight through, so `pnpm check` in the hook reports as it runs;
    // stderr kept, to tell a refusal from a network failure.
    const r = spawnSync("git", ["push", "origin", `HEAD:${TARGET}`],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
    process.stderr.write(r.stderr);
    if (r.status === 0) return "pushed";
    if (/\[rejected\]|non-fast-forward|fetch first/.test(r.stderr)) return "moved";
    // The hook's own verdict: a red `pnpm check` is not something to retry.
    if (/failed to push some refs/.test(r.stderr) && !/Could not resolve|unable to access|Connection|timed out|RPC failed|early EOF/i.test(r.stderr)) {
      stop(1, "\npush: refused before it left — the output above says why (usually `pnpm check`).");
    }
  }
  stop(1, "push: the network kept failing; nothing was pushed");
}

async function ship() {
  if (git("status", "--porcelain")) stop(1, "push: commit first — what is uncommitted would not be pushed");
  await fetchUpstream();
  if (git("merge-base", "--is-ancestor", UPSTREAM, "HEAD") === null) catchUp();
  if (git("rev-list", "--count", `${UPSTREAM}..HEAD`) === "0") stop(0, `push: nothing here that ${TARGET} doesn't have`);
  bump();
  if (await pushOnce() === "moved") {
    await fetchUpstream();
    catchUp();
  }
  return git("rev-parse", "HEAD");
}

/* ---- the run ------------------------------------------------------------ */

const [, , flag, arg] = process.argv;
const sha = flag === "--watch" ? (arg ?? git("rev-parse", "HEAD")) : await ship();
const red = report(await watch(sha));
say(red ? "\nwatch: red — this push is yours to fix" : "\nwatch: green");
process.exit(red ? 1 : 0);
