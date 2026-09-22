/**
 * The gate's memory: what tree did `pnpm check` last pass over? Each push runs
 * it twice (session, then `pre-push`), and the second run's thirty seconds is
 * what tempts `--no-verify`. So a pass is stamped, and a run over the same
 * tree exits.
 *
 * The fingerprint is **contents, not mtimes**: `git checkout` moves contents
 * backwards while moving mtimes forwards, and being wrong here is an
 * unchecked deploy. Hashing costs milliseconds.
 *
 * Covers every file git tracks or would track (so a new file counts and
 * `pnpm-lock.yaml` catches dependency changes), plus the git-ignored env files
 * `next build` still reads.
 *
 * Can't cover: hand-edited `node_modules`, a different Node. Both are
 * `pnpm check --force`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

/** Secrets and env, ignored by git and read by the build all the same. */
function unlistedInputs() {
  const dirs = [ROOT, ...["apps", "packages"].flatMap((group) => {
    const at = join(ROOT, group);
    return existsSync(at) ? readdirSync(at).map((name) => join(at, name)) : [];
  })];
  return dirs.flatMap((dir) => readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.startsWith(".env") || e.name === ".dev.vars"))
    .map((e) => join(dir, e.name)));
}

/** A hash of everything the gate reads. Take it *before* running the stages:
 *  what passed is the tree as it stood, not whatever the run left behind. */
export function fingerprint() {
  const listed = git("ls-files", "-z", "-c", "-o", "--exclude-standard").split("\0").filter(Boolean);
  const all = [...listed.map((p) => join(ROOT, p)), ...unlistedInputs()].sort();
  const hash = createHash("sha256");
  for (const path of all) {
    hash.update(path.slice(ROOT.length));
    hash.update("\0");
    // A file listed and then deleted between the two calls is a changed tree,
    // which is what an unreadable entry should hash as rather than throw on.
    try { hash.update(readFileSync(path)); } catch { hash.update("gone"); }
    hash.update("\0");
  }
  return hash.digest("hex");
}

const stampFile = () => join(ROOT, git("rev-parse", "--git-dir").trim(), "bida-check-stamp");

/** How long ago this tree last passed, or null if it never did. */
export function stampMatches(tree) {
  try {
    const [hash, at] = readFileSync(stampFile(), "utf8").split(" ");
    if (hash !== tree) return null;
    const ago = Math.round((Date.now() - Number(at)) / 1000);
    return ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)}min ago`;
  } catch {
    return null;
  }
}

export function writeStamp(tree) {
  try {
    writeFileSync(stampFile(), `${tree} ${Date.now()}`);
  } catch {
    // A stamp that cannot be written costs a re-run, never a wrong pass.
  }
}
