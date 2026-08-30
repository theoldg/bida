#!/usr/bin/env node
/**
 * `pnpm rules` — the rules the docs state, checked against the code.
 *
 * Two of this project's decisions are one careless line away from being quietly
 * reversed, and either would be found months later by a person rather than by a
 * test: core stops being pure, or a browser dialog creeps back in. Cheap to
 * check, expensive to rediscover — so they run in `pnpm check`.
 *
 * The bar for adding one: it is written down as a decision, a single line
 * reverses it, and no test would notice. Style is not on this list — there is
 * no linter here on purpose.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "out", ".git", "dist"]);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [path] : [];
  });
}

/**
 * Comments and string literals out, so a rule matches code and not the prose
 * explaining why the rule exists — `dialog.tsx` says "in place of `prompt()`"
 * seven times, and a check that fails on that gets deleted within a week.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ")
  .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

const problems = [];
const fail = (file, rule) => problems.push(`${relative(ROOT, file)}\n        ${rule}`);

// CLAUDE.md: core is pure — no I/O, no framework, and it takes its clock as an
// argument rather than reading one.
for (const file of sources(join(ROOT, "packages/core/src"))) {
  const raw = readFileSync(file, "utf8");
  const src = code(raw);
  // From the raw source: an import specifier is the one string literal that
  // matters here, and `code()` has blanked it.
  for (const [, spec] of raw.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)) {
    if (!spec.startsWith(".")) {
      fail(file, `imports "${spec}" — core is pure: no framework, no I/O (CLAUDE.md)`);
    }
  }
  for (const io of ["document", "window", "localStorage", "indexedDB", "fetch"]) {
    if (new RegExp(`\\b${io}\\b`).test(src)) fail(file, `touches \`${io}\` — core does no I/O (CLAUDE.md)`);
  }
  for (const ambient of ["Date.now", "Math.random"]) {
    if (src.includes(ambient)) {
      fail(file, `calls \`${ambient}\` — core takes its clock, and its randomness, as an argument (CLAUDE.md)`);
    }
  }
}

// ADR-0008, and the owner said it three times: asking is components/dialog.tsx.
for (const file of sources(join(ROOT, "apps/web"))) {
  const src = code(readFileSync(file, "utf8"));
  // A call, not a declaration: `prompt(): Promise<void>` in a DOM interface is
  // the shape of the thing, not a use of it.
  for (const [, call] of src.matchAll(/(?:^|[^.\w])\b(prompt|confirm|alert)\s*\((?!\s*\)\s*:)/g)) {
    fail(file, `\`${call}()\` — no browser dialogs; ask with components/dialog.tsx (ADR-0008)`);
  }
  if (/<select[\s>]/.test(src)) fail(file, "`<select>` — every picker is our own ChoiceDialog (ADR-0008)");
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\n${problems.length} broken rule(s)` : "rules: core is pure, no browser dialogs");
process.exit(problems.length ? 1 : 0);
