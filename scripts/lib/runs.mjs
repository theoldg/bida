/**
 * The deploy run a push of a commit to `dev` started, read off the GitHub API:
 * waited on until every job has a verdict, then reported with the failures
 * pinned to it. Shared by `pnpm push` (did my push go green?) and
 * `release-gate.mjs` (may this commit reach `main`?).
 */
import { spawnSync } from "node:child_process";

import { ROOT } from "./together.mjs";

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const say = (text = "") => console.log(text);
function stop(code, text) {
  if (text) console.error(text);
  process.exit(code);
}

export const REPO = (() => {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" });
  const url = r.status === 0 ? r.stdout.trim() : "";
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url) ?? /\/([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : stop(1, `cannot tell the GitHub repository from origin (${url})`);
})();

/** A token if one is at hand: unauthenticated, a laptop gets 60 calls an hour. */
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  || spawnSync("gh", ["auth", "token"], { encoding: "utf8" }).stdout?.trim() || "";

/**
 * Through curl rather than `fetch`: curl honours `HTTPS_PROXY`, which is the
 * only way out of the agent environment, and Node's `fetch` does not.
 */
function api(path) {
  const r = spawnSync("curl", [
    "-sS", "--fail-with-body", "--max-time", "30",
    "-H", "Accept: application/vnd.github+json",
    ...(TOKEN ? ["-H", `Authorization: Bearer ${TOKEN}`] : []),
    `https://api.github.com/repos/${REPO}${path}`,
  ], { encoding: "utf8" });
  try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

const ICON = { success: "  ok  ", failure: "FAIL  ", cancelled: "skip  ", skipped: "skip  ", timed_out: "FAIL  " };

/**
 * Every job of the runs that pushing `sha` to `dev` started, once all of them
 * have finished. A re-run counts: the API answers with a run's latest attempt.
 */
export async function watch(sha, who = "watch") {
  say(`\n${who}: the run for ${sha.slice(0, 7)} on ${REPO}`);
  let runs = [];
  for (const end = Date.now() + 180_000; !runs.length; await sleep(5000)) {
    if (Date.now() > end) stop(1, `${who}: no run started for this commit in three minutes — look at the Actions tab`);
    runs = (api(`/actions/runs?head_sha=${sha}&event=push&branch=dev`)?.workflow_runs ?? []);
  }
  for (const run of runs) say(`      ${run.name}: ${run.html_url}`);

  const seen = new Map();
  let jobs = [];
  for (const end = Date.now() + 40 * 60_000; ; await sleep(10_000)) {
    if (Date.now() > end) stop(1, `${who}: forty minutes without a verdict — look at the run`);
    const fresh = runs.flatMap((run) => api(`/actions/runs/${run.id}/jobs`)?.jobs ?? null);
    if (fresh.includes(null)) continue; // a call that failed is asked again, not read as an answer
    jobs = fresh;
    for (const job of jobs) {
      const step = job.steps?.find((s) => s.status === "in_progress")?.name;
      const state = job.status === "completed" ? job.conclusion : `${job.status}${step ? `: ${step}` : ""}`;
      if (seen.get(job.id) !== state) {
        seen.set(job.id, state);
        say(job.status === "completed" ? `${ICON[job.conclusion] ?? "  ?   "}${job.name}` : `  …   ${job.name} — ${state}`);
      }
    }
    if (jobs.length && jobs.every((j) => j.status === "completed")) break;
  }
  return jobs;
}

/** Print what failed and why, from the annotations; true when a job failed. */
export function report(jobs) {
  let red = false;
  for (const job of jobs) {
    const notes = api(`/check-runs/${job.id}/annotations`) ?? [];
    const failing = job.conclusion === "failure" || job.conclusion === "timed_out";
    red ||= failing;
    if (failing) {
      const step = job.steps?.find((s) => s.conclusion === "failure")?.name;
      say(`\n──── ${job.name} failed${step ? ` at “${step}”` : ""}`);
    }
    for (const note of notes) {
      // Ours only: GitHub adds one for a step's exit code, which ours say
      // better, and notices about the runner, which are nobody's to act on.
      const ours = note.annotation_level === "failure" || /^flaky/.test(note.title ?? "");
      if (!ours || /^Process completed with exit code/.test(note.message)) continue;
      say(`\n${note.annotation_level === "failure" ? "FAIL" : "note"}  ${note.title ?? ""}\n${note.message}`);
    }
    if (failing && !notes.some((n) => n.annotation_level === "failure" && !/^Process completed/.test(n.message))) {
      say(`      no message pinned — the log is at ${job.html_url}`);
      if (/build/.test(job.steps?.find((s) => s.conclusion === "failure")?.name ?? "")) say("      (`pnpm run build` reproduces it here)");
    }
    if (job.name === "deploy" && job.conclusion === "cancelled") say("\nnote  a newer push is deploying over this one");
  }
  return red;
}
