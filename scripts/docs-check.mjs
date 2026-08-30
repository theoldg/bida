#!/usr/bin/env node
/**
 * `pnpm docs` — do the docs still point at things that exist?
 *
 * These docs exist so a cold agent is useful in five minutes, and the way that
 * decays is quiet: a heading gets reworded, an ADR is folded into another, and
 * every link into it now lands on the top of a file with no hint of what it was
 * meant to show. Nothing else in the repo notices. This does, in about 30ms, so
 * it runs as part of `pnpm check`.
 *
 * Checked: every relative markdown link resolves to a file, and every `#anchor`
 * into a markdown file matches a heading there — by GitHub's slug rules, since
 * that is where these get clicked.
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

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\n${problems.length} broken doc link(s)` : "docs: every link resolves");
process.exit(problems.length ? 1 : 0);
