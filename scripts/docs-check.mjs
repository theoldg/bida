#!/usr/bin/env node
/**
 * `pnpm run docs` — do the docs still point at things that exist?
 *
 * These docs exist so a cold agent is useful in five minutes, and the way that
 * decays is quiet: a heading gets reworded, an ADR is folded into another, and
 * every link into it now lands on the top of a file with no hint of what it was
 * meant to show. Nothing else in the repo notices. This does, in about 30ms, so
 * it runs as part of `pnpm check`.
 *
 * Checked: every relative markdown link resolves to a file; every `#anchor`
 * into a markdown file matches a heading there, by GitHub's slug rules since
 * that is where these get clicked; the ADR index names every ADR on disk and
 * nothing else, so a folded-away decision can't leave a row behind; no doc
 * states a test count, which is a number that is wrong by the next commit and
 * tells a reader nothing they wanted to know; and claude_corner.md keeps to the
 * three numbers its own house rules name.
 *
 * Whether any other doc has grown too long, or whether it should have gained an
 * ADR or a standing instruction at all, is a judgement — CLAUDE.md and the head
 * of each of those two files carry the bar. Deliberately not counted here. The
 * corner is the exception because it fixed its own limits in writing.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, normalize } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "out", ".git", "shots", ".wrangler"]);

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return markdownFiles(path);
    return e.name.endsWith(".md") ? [path] : [];
  });
}

/** GitHub's heading slug: strip formatting, lowercase, spaces to hyphens. */
const slug = (heading) => heading
  // Underscores stay: they are word characters in a slug, not emphasis.
  .replace(/[`*~]/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .trim().toLowerCase()
  // Unicode-aware, because GitHub is: it keeps the "ś" in "Staś mode" and
  // slugs it `#staś-mode`. `\w` would drop it and this check would then
  // reject a link that works.
  .replace(/[^\p{L}\p{N}\s_-]/gu, "")
  .replace(/\s/g, "-");

const anchorsOf = (file) => new Set(
  [...readFileSync(file, "utf8").matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])),
);

const anchors = new Map();
const problems = [];

for (const file of markdownFiles(ROOT)) {
  const source = readFileSync(file, "utf8");
  // Links only — an image or a bare URL has nothing to go stale against a heading.
  for (const [, text, target] of source.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [path, fragment] = target.split("#");
    const to = normalize(join(dirname(file), path));
    const where = `${relative(ROOT, file)}: [${text}](${target})`;
    if (!existsSync(to) || !statSync(to).isFile()) {
      problems.push(`${where}\n        no such file`);
      continue;
    }
    if (!fragment || !to.endsWith(".md")) continue;
    if (!anchors.has(to)) anchors.set(to, anchorsOf(to));
    if (!anchors.get(to).has(fragment.toLowerCase())) {
      problems.push(`${where}\n        no heading "#${fragment}" in ${relative(ROOT, to)}`);
    }
  }
}

// The index and the ADRs on disk say the same thing, in both directions.
const adrDir = join(ROOT, "docs", "decisions");
const adrs = readdirSync(adrDir).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
const index = readFileSync(join(adrDir, "README.md"), "utf8");
const listed = new Set([...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]));
for (const f of adrs) {
  if (!listed.has(f)) problems.push(`docs/decisions/${f}\n        not in the index table in README.md`);
}
for (const f of listed) {
  if (!adrs.includes(f)) problems.push(`docs/decisions/README.md\n        indexes ${f}, which does not exist`);
}

/**
 * A count of tests is stale the moment somebody writes one, and re-stating it
 * says nothing `pnpm check` doesn't say out loud on every run. The owner's
 * call, 2026-09-06: "useless and always stale". Say what the suite covers
 * instead — that is what a reader came for and it survives a commit.
 */
for (const file of markdownFiles(ROOT)) {
  for (const [said] of readFileSync(file, "utf8").matchAll(/\b\d[\d,]*\s+tests\b/gi)) {
    problems.push(`${relative(ROOT, file)}\n        "${said}" — a test count goes stale; say what they cover`);
  }
}

/**
 * Claude's corner is the one doc every session is asked to add to, and it grew
 * to thirteen postcards under a rule saying ten — nobody decided that, it is
 * just what "add a line" does when the eviction is somebody else's problem.
 * So the numbers it states about itself are enforced here, and the file says
 * they are. Room is made by cutting, in the same edit as the addition.
 */
const CORNER = { lines: 100, postcards: 10, chars: 200 };
const cornerFile = join(ROOT, "docs", "claude_corner.md");
const corner = readFileSync(cornerFile, "utf8").replace(/\n$/, "");
const cornerLines = corner.split("\n").length;
if (cornerLines > CORNER.lines) {
  problems.push(
    `docs/claude_corner.md\n        ${cornerLines} lines, over ${CORNER.lines} — cut before you add`,
  );
}
const postcardSection = corner.split(/^## Postcards$/m)[1];
if (postcardSection === undefined) {
  problems.push(`docs/claude_corner.md\n        no "## Postcards" section to check`);
} else {
  const postcards = postcardSection
    .split(/^## /m)[0]
    .split(/\n(?=- )/)
    .filter((entry) => entry.startsWith("- "))
    // One postcard, however it happens to be wrapped.
    .map((entry) => entry.trim().replace(/\s+/g, " "));
  if (postcards.length > CORNER.postcards) {
    problems.push(
      `docs/claude_corner.md\n        ${postcards.length} postcards, over ${CORNER.postcards}` +
        ` — evict the oldest, and fold what it taught into the prose above if it has become general`,
    );
  }
  for (const card of postcards) {
    if (card.length > CORNER.chars) {
      problems.push(
        `docs/claude_corner.md\n        postcard is ${card.length} characters, over ${CORNER.chars}` +
          `: ${card.slice(0, 48)}…`,
      );
    }
  }
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(
  problems.length
    ? `\n${problems.length} problem(s)`
    : `docs: every link resolves, every ADR indexed, no counts to go stale, the corner within its limits`,
);
process.exit(problems.length ? 1 : 0);
