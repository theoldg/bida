#!/usr/bin/env node
/**
 * `pnpm bump` — the number the app calls itself, and the gate that says when it
 * has to move.
 *
 * **`major.semi.minor`, and only the owner moves the first one.** The three
 * places mean three different sizes of change, and they are bumped by three
 * different people:
 *
 * | | Who | When |
 * |---|---|---|
 * | **major** | The owner, in words, in a session | Never on an agent's judgement. `pnpm bump major` refuses |
 * | **semi** | Whoever is working | When the app is meaningfully a different thing than it was. `pnpm bump semi` |
 * | **minor** | Every push to `dev` | A push deploys (docs/hosting.md#versions), so a deploy always shows a new number. `pnpm bump` |
 *
 * The version lives in the root `package.json`, which is the only copy —
 * `apps/*` are private packages and carry none. The web build reads it there
 * (`apps/web/next.config.mjs`) and the app shows it on `/about` and prints it
 * as the first line of `/diag`, which is the whole point: a pasted report says
 * which build it came from.
 *
 * Nobody is expected to remember any of this, which is why `--check` is a stage
 * of `pnpm check` (scripts/check.mjs): a tree that differs from what `dev` is
 * serving and still calls itself the same number fails the gate before it can
 * be pushed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST = join(ROOT, "package.json");

/** What a push deploys. `dev` is the branch sessions push to, and pushing it
 *  is what runs deploy.yml — so "what dev holds" is "what is deployed". */
const DEPLOYED = "origin/dev";

/** Git, with a missing ref answering `null` rather than throwing: a fresh
 *  clone with no `origin/dev` yet is a tree with nothing to compare against,
 *  not a broken one. */
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** `0.1.7` → `[0, 1, 7]`. Anything else is not a version this project wrote. */
function parse(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

const show = (parts) => parts.join(".");

/** -1, 0, 1 — place by place, so 0.2.0 beats 0.1.9 rather than sorting under it. */
function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

const versionIn = (source) => parse(JSON.parse(source).version);
const here = () => versionIn(readFileSync(MANIFEST, "utf8"));
const deployed = () => {
  const source = git("show", `${DEPLOYED}:package.json`);
  return source ? versionIn(source) : null;
};

/**
 * Written back by replacing the number in place rather than re-serialising the
 * manifest: `JSON.stringify` would reformat a file people read, and the diff of
 * a version bump should be one line.
 */
function write(parts) {
  const source = readFileSync(MANIFEST, "utf8");
  const stamped = source.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${show(parts)}$2`);
  if (stamped === source) {
    console.error(`version: no \`"version": "x.y.z"\` to replace in package.json`);
    process.exit(1);
  }
  writeFileSync(MANIFEST, stamped);
}

/**
 * Is there anything here that `dev` is not already serving? Committed *or* not:
 * uncommitted work is what the push about to happen will carry, and asking only
 * about commits would let the bump be forgotten until after `pnpm check` had
 * already stamped the tree as passing.
 */
function undeployed() {
  const ahead = git("rev-list", "--count", `${DEPLOYED}..HEAD`)?.trim();
  return (ahead !== null && ahead !== "0") || Boolean(git("status", "--porcelain")?.trim());
}

/** The gate. A change that will deploy must carry a number above the deployed one. */
function check() {
  const mine = here();
  if (!mine) {
    console.error("version: package.json has no `major.semi.minor` version (scripts/version.mjs)");
    return 1;
  }
  const live = deployed();
  if (!live) {
    console.log(`version: ${show(mine)} — nothing to compare it to, ${DEPLOYED} carries no version`);
    return 0;
  }
  if (!undeployed()) {
    console.log(`version: ${show(mine)}, which is what dev is serving`);
    return 0;
  }
  if (compare(mine, live) > 0) {
    console.log(`version: ${show(mine)}, up from the ${show(live)} dev is serving`);
    return 0;
  }
  console.error(
    `FAIL  version\n        this tree is not what dev is serving, and still calls itself ${show(mine)}`
    + `${compare(mine, live) < 0 ? ` — behind the deployed ${show(live)}` : ""}\n`
    + "        a push to dev deploys, and a deploy shows a new number: run `pnpm bump`\n"
    + "        (docs/hosting.md#versions)");
  return 1;
}

/**
 * Bump to one past what is deployed, not one past what is here: run twice
 * before a push it is a no-op the second time, so a session that bumps at every
 * checkpoint spends one number per deploy rather than one per thought.
 */
function bump(kind) {
  const base = deployed() ?? here();
  const mine = here();
  if (!base || !mine) {
    console.error("version: package.json has no `major.semi.minor` version (scripts/version.mjs)");
    return 1;
  }
  const [major, semi, minor] = base;
  const target = kind === "semi" ? [major, semi + 1, 0] : [major, semi, minor + 1];
  if (compare(mine, target) >= 0) {
    console.log(`version: ${show(mine)} already, against the ${show(base)} dev is serving — nothing to bump`);
    return 0;
  }
  write(target);
  console.log(`version: ${show(mine)} → ${show(target)}`);
  if (kind === "semi") console.log("  say so in your summary: a semi-major bump is a claim about the app");
  return 0;
}

const [, , arg] = process.argv;

if (arg === "--check") process.exit(check());
if (arg === "major") {
  // The one number no session decides. The owner said it in as many words:
  // bumping it is "a bigger decision that always involves me".
  console.error("version: the major is the owner's call, in a session, in their words — never a script's");
  process.exit(1);
}
if (arg && arg !== "semi" && arg !== "minor") {
  console.error("usage: pnpm bump [semi]   (no argument bumps the deploy number)");
  process.exit(1);
}
process.exit(bump(arg));
