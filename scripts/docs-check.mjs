#!/usr/bin/env node
/**
 * `pnpm run docs` — do the docs still point at things that exist, and are they
 * still short?
 *
 * These docs exist so a cold agent is useful in five minutes, and they decay in
 * two quiet ways. A heading gets reworded, an ADR is folded into another, and
 * every link into it now lands on the top of a file with no hint of what it was
 * meant to show. And every session adds a paragraph nobody asked for — the
 * owner, 2026-09-03: *"every time i make a request, the ADRs, owner preferences
 * and whatnot get more inflated."* Nothing else in the repo notices either one.
 * This does, in about 30ms, so it runs as part of `pnpm check`.
 *
 * Checked: every relative markdown link resolves to a file; every `#anchor`
 * into a markdown file matches a heading there (GitHub's slug rules, since that
 * is where these get clicked); and every doc is inside its line budget, with
 * the whole set inside TOTAL.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, normalize, sep } from "node:path";

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
  .replace(/[^\w\s-]/g, "")
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

/**
 * Line budgets. A doc that outgrows its number is not "nearly done" — it has
 * absorbed something that belongs somewhere else, or is repeating a doc that
 * already says it. Cut, fold, or move it; then lower the number.
 *
 * TOTAL is the one that matters. It is a few percent above where the set
 * actually sits, so real new behaviour can cost a paragraph — but it means a
 * doc can only grow if another shrinks, which is the whole point. **Raising
 * TOTAL, or a budget, is the owner's call and not a way to land a session.**
 */
const BUDGET = {
  "README.md": 20,
  "CLAUDE.md": 135,
  "docs/README.md": 30,
  "docs/architecture.md": 85,
  "docs/data-model.md": 185,
  "docs/design-system.md": 175,
  "docs/frontend.md": 215,
  "docs/hosting.md": 115,
  "docs/implementation-status.md": 175,
  "docs/product.md": 75,
  "docs/receipt-scanning.md": 185,
  "docs/roadmap.md": 95,
  "docs/standing-instructions.md": 125,
  "docs/sync.md": 145,
  "docs/testing.md": 150,
  "docs/decisions/README.md": 40,
};
/** Every ADR, and the bar is the same for all of them. */
const ADR_BUDGET = 80;
const TOTAL = 2650;

const budgeted = markdownFiles(ROOT).filter((f) => !relative(ROOT, f).startsWith("docs/shots"));
let total = 0;

for (const file of budgeted.sort()) {
  const name = relative(ROOT, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split("\n").length;
  total += lines;
  const cap = BUDGET[name] ?? (/^docs\/decisions\/\d/.test(name) ? ADR_BUDGET : null);
  if (cap === null) {
    problems.push(`${name}\n        no line budget — add one to scripts/docs-check.mjs`);
  } else if (lines > cap) {
    problems.push(`${name}\n        ${lines} lines, budget ${cap} — cut ${lines - cap}, or fold it into the doc that already says it`);
  }
}
if (total > TOTAL) {
  problems.push(`all docs\n        ${total} lines, budget ${TOTAL} — cut ${total - TOTAL} somewhere before adding more`);
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(
  problems.length
    ? `\n${problems.length} problem(s)`
    : `docs: every link resolves · ${total}/${TOTAL} lines (${TOTAL - total} spare)`,
);
process.exit(problems.length ? 1 : 0);
