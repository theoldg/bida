/**
 * Run a handful of independent commands at once and report them as one gate
 * — the shape `pnpm check` and `pnpm verify` share. Unlike `&&`:
 *
 * - **Runs them together**, so the gate costs its slowest job.
 * - **Runs all of them**, so one run says everything that is broken.
 * - **Keeps the output**: a pass prints a line and a digest per job; only
 *   failed jobs spill.
 *
 * A job is `{ name, run: [cmd, ...args], rerun, digest }`. `digest(output)`
 * returns the lines worth printing on a pass — keep it to what a reader would
 * have scrolled to find, and prefer something *absent* when the job did
 * nothing, since a silent no-op is the failure neither gate otherwise sees.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");

// `pnpm check | head` closes stdout mid-run. That is the reader leaving, not a
// failure of the gate — without this the runner dies on EPIPE and reports a
// fake red on a green tree.
process.stdout.on("error", () => {});

/**
 * On GitHub Actions, pin a message to the run — the one piece of a run the
 * API hands out without a download: a job's log lives on a blob host the
 * agent environment cannot reach, and its annotations are plain JSON
 * (scripts/push.mjs reads them back). The harness's `FAIL` lines with the
 * detail under each, since a check's passes outnumber them fifty to one; the
 * tail when there are none, since a crash prints last.
 */
export function annotation(level, title, text) {
  if (!process.env.GITHUB_ACTIONS) return;
  const all = text.trimEnd().split("\n");
  const failing = all.flatMap((line, i) => {
    if (!/^FAIL  /.test(line)) return [];
    const detail = [];
    for (let j = i + 1; j < all.length && /^ {4,}\S/.test(all[j]); j++) detail.push(all[j]);
    return [line, ...detail];
  });
  // The head of the failures (the first is the one to read), the tail of a crash.
  const kept = failing.length ? failing.slice(0, 40) : all.slice(-40);
  const tail = kept.map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l)).join("\n");
  const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::${level} title=${escape(title).replace(/[:,]/g, " ")}::${escape(tail)}`);
}

const runJob = (job) => new Promise((done) => {
  const at = Date.now();
  const child = spawn(job.run[0], job.run.slice(1), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (b) => { output += b; });
  child.stderr.on("data", (b) => { output += b; });
  // A missing binary never reaches 'close' with a code, so say which one.
  child.on("error", (e) => { output += `${e.message}\n`; });
  child.on("close", (code) => {
    const result = { ...job, ok: code === 0, seconds: (Date.now() - at) / 1000, output };
    // Printed as each finishes, so a half-minute run is never a silent terminal.
    console.log(`${result.ok ? "  ok  " : "FAIL  "}${job.name.padEnd(11)}${result.seconds.toFixed(1).padStart(5)}s`);
    if (result.ok) for (const line of job.digest?.(output) ?? []) console.log(`        ${line}`);
    done(result);
  });
});

/**
 * Run them all, print the report, and hand back whatever failed. `limit` caps
 * how many run at once — the rest queue, in the order given. `annotate: false`
 * keeps a failure off the run's annotations, for a caller that will try again.
 */
export async function runTogether(label, jobs, { limit = jobs.length, annotate = true } = {}) {
  const started = Date.now();
  const how = limit < jobs.length ? `${limit} at a time` : "together";
  console.log(`${label}  ${jobs.map((j) => j.name).join(" ")} — ${how}\n`);

  const results = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) { const i = next++; results[i] = await runJob(jobs[i]); }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, lane));
  const failed = results.filter((r) => !r.ok);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  for (const job of failed) {
    console.log(`\n──── ${job.name} ${"─".repeat(Math.max(0, 66 - job.name.length))}`);
    console.log(job.output.trimEnd());
    if (annotate) annotation("error", `${label}: ${job.name} failed`, job.output);
  }

  if (!failed.length) {
    console.log(`\n${label}: all ${results.length} passed in ${elapsed}s`);
    return failed;
  }
  console.log(
    `\n${label}: ${failed.length} of ${results.length} failed in ${elapsed}s — ` +
    failed.map((j) => `\`${j.rerun}\``).join(", ") + (failed.length > 1 ? " on their own" : " on its own"),
  );
  return failed;
}
