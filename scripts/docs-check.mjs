#!/usr/bin/env node
/**
 * `pnpm run docs` — do the docs still point at things that exist?
 *
 * Docs decay quietly: a heading is reworded, an ADR folded away, and every
 * link into it lands on a file's top. This catches it in ~30ms, in
 * `pnpm check`.
 *
 * Checked: every relative markdown link resolves, and so does every
 * `docs/….md` a code comment names, and every source file names one; every `#anchor` — a bare one included —
 * matches a heading by GitHub's slug rules (where they get clicked); the ADR index names
 * exactly the ADRs on disk; no doc states a test count; no doc runs past
 * 400 lines, nor its Gotchas past 30; claude-corner.md keeps to its own three
 * limits.
 *
 * Whether something deserved an ADR or standing instruction is a judgement
 * (those files' heads), not counted here.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, normalize } from "node:path";

import { ROOT } from "./lib/together.mjs";
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
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, fragment] = target.split("#");
    // A bare `#anchor` is this file: the one link a split moves out from under.
    const to = path ? normalize(join(dirname(file), path)) : file;
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
 * Code comments point into the docs too (`docs/navigation.md#routing`), and
 * nothing clicks those, so nothing else notices when a doc is split or a
 * heading reworded under them.
 */
const CODE = /\.(ts|tsx|mjs|js|css|yml)$/;
function codeFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name) || (e.name.startsWith(".") && e.name !== ".github")) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return codeFiles(path);
    return CODE.test(e.name) ? [path] : [];
  });
}
for (const file of codeFiles(ROOT)) {
  const source = readFileSync(file, "utf8");
  for (const [said, path, fragment] of source.matchAll(/\b(docs\/[\w./-]+?\.md)(?:#([\p{L}\p{N}_-]+))?/gu)) {
    const to = join(ROOT, path);
    const where = `${relative(ROOT, file)}: ${said}`;
    if (!existsSync(to)) {
      problems.push(`${where}\n        no such file`);
      continue;
    }
    if (!fragment) continue;
    if (!anchors.has(to)) anchors.set(to, anchorsOf(to));
    if (!anchors.get(to).has(fragment.toLowerCase())) {
      problems.push(`${where}\n        no heading "#${fragment}" in ${path}`);
    }
  }
}

/**
 * Every source file names the doc that explains it, so an agent who opens the
 * code finds the prose without going through the README's table. The pointer
 * is checked above like any other; here it only has to exist. A barrel that
 * re-exports and a test are exempt: neither is where a change is made.
 */
const SOURCES = ["packages/core/src", "apps/web/lib", "apps/web/components", "apps/web/app", "apps/api/src"];
for (const dir of SOURCES) {
  for (const file of codeFiles(join(ROOT, dir))) {
    const name = relative(ROOT, file);
    if (!/\.tsx?$/.test(name) || /\.test\.|\.d\.ts$/.test(name)) continue;
    if (/(^|\/)index\.ts$/.test(name) && !/\/commands\//.test(name)) continue;
    if (!/\bdocs\/[\w./-]+\.md/.test(readFileSync(file, "utf8"))) {
      problems.push(`${name}\n        names no doc — add "// Doc: docs/<doc>.md#<section> — read it whole before changing this file."`);
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
 * A test count is stale the moment someone writes a test, and `pnpm check`
 * reports it anyway. Say what the suite covers instead.
 */
for (const file of markdownFiles(ROOT)) {
  for (const [said] of readFileSync(file, "utf8").matchAll(/\b\d[\d,]*\s+tests\b/gi)) {
    problems.push(`${relative(ROOT, file)}\n        "${said}" — a test count goes stale; say what they cover`);
  }
}

/**
 * A doc nobody reads whole is one that drifts: an agent greps its way to one
 * paragraph and edits that, and the copy three screens down goes stale. The
 * owner asks that docs be read whole (standing-instructions.md#workflow), and
 * these two limits keep that affordable. Past either, split the doc by subject
 * or delete what the code now says for itself — a gotcha a check enforces is
 * the first to go.
 */
const LIMIT = { lines: 400, gotchas: 30 };
for (const file of markdownFiles(join(ROOT, "docs"))) {
  const text = readFileSync(file, "utf8").replace(/\n$/, "");
  const lines = text.split("\n").length;
  const name = relative(ROOT, file);
  if (lines > LIMIT.lines) {
    problems.push(`${name}\n        ${lines} lines, over ${LIMIT.lines} — split it by subject, or cut`);
  }
  const gotchas = text.split(/^## Gotchas$/m)[1]?.split(/^## /m)[0].trim();
  const gotchaLines = gotchas ? gotchas.split("\n").length : 0;
  if (gotchaLines > LIMIT.gotchas) {
    problems.push(
      `${name}\n        Gotchas is ${gotchaLines} lines, over ${LIMIT.gotchas}` +
        ` — delete what a check or the code now holds, or move one into the section it is about`,
    );
  }
}

/**
 * Claude's corner is the one doc every session adds to, so without a check it
 * grows past its stated limits. The numbers it states about itself are
 * enforced here; room is made by cutting in the same edit.
 */
const CORNER = { lines: 100, postcards: 12, chars: 300 };
const cornerFile = join(ROOT, "docs", "claude-corner.md");
const corner = readFileSync(cornerFile, "utf8").replace(/\n$/, "");
const cornerLines = corner.split("\n").length;
if (cornerLines > CORNER.lines) {
  problems.push(
    `docs/claude-corner.md\n        ${cornerLines} lines, over ${CORNER.lines} — cut before you add`,
  );
}
const postcardSection = corner.split(/^## Postcards$/m)[1];
if (postcardSection === undefined) {
  problems.push(`docs/claude-corner.md\n        no "## Postcards" section to check`);
} else {
  const postcards = postcardSection
    .split(/^## /m)[0]
    .split(/\n(?=- )/)
    .filter((entry) => entry.startsWith("- "))
    // One postcard, however it happens to be wrapped.
    .map((entry) => entry.trim().replace(/\s+/g, " "));
  if (postcards.length > CORNER.postcards) {
    problems.push(
      `docs/claude-corner.md\n        ${postcards.length} postcards, over ${CORNER.postcards}` +
        ` — evict the oldest, and fold what it taught into the prose above if it has become general`,
    );
  }
  for (const card of postcards) {
    if (card.length > CORNER.chars) {
      problems.push(
        `docs/claude-corner.md\n        postcard is ${card.length} characters, over ${CORNER.chars}` +
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
