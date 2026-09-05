#!/usr/bin/env node
/**
 * `pnpm rules` — the rules the docs state, checked against the code.
 *
 * Three of this project's decisions are one careless line away from being
 * quietly reversed, and each would be found months later by a person rather
 * than by a test: core stops being pure, a browser dialog creeps back in, or a
 * sentence is typed into a screen instead of into lib/copy.ts. Cheap to check,
 * expensive to rediscover — so they run in `pnpm check`.
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

// docs/invariants.md: a guard and its healer must be one declaration. Every
// defect of that class so far was a refusal whose repair was never written, so
// a screen must take its verdict from the registry (`data.guard`), which cannot
// be declared without a repair. `entriesInvolving` stays allowed: a screen may
// ask what to *name*, never whether to refuse.
for (const file of sources(join(ROOT, "apps/web"))) {
  const src = code(readFileSync(file, "utf8"));
  if (/\bmemberInvolved\b/.test(src)) {
    fail(file, "calls `memberInvolved` — a refusal comes from `data.guard`, so it "
      + "cannot outlive its healer (docs/invariants.md)");
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

/**
 * Every word a person reads lives in `apps/web/lib/copy.ts` (ADR-0033). One
 * literal typed straight into a screen is invisible until the day someone asks
 * for a second language, so it is caught here instead.
 *
 * Two shapes are findable without a parser and cover what actually slips in:
 * text sitting between JSX tags, and the three attributes that are read aloud
 * or shown in a blank field. Everything else — a string handed to a prop — is
 * left to review; this is a fence, not a type system.
 */
const COPY_FILE = join(ROOT, "apps/web/lib/copy.ts");
const SPEAKING_ATTRS = /\b(aria-label|placeholder|title)=(["'])([^"'{}]*[A-Za-z]{2}[^"'{}]*)\2/g;
/** Text between tags, inline or wrapped: `>Save<`, `>\n  A sentence.\n<`. */
const JSX_TEXT = />([^<>{}=()[\];:`$]*?[A-Za-z]{2}[^<>{}=()[\];:`$]*?)</g;

/**
 * `Promise<void>`, `Omit<Props, "size">` — a generic's `>` is not a tag's, and
 * the type after it reads as text between tags. Dropped innermost-first, so
 * nested ones go too.
 */
function withoutGenerics(src) {
  let out = src, prev;
  do { prev = out; out = out.replace(/(?<=[\w$])<[^<>]*>/g, ""); } while (out !== prev);
  return out;
}

for (const file of sources(join(ROOT, "apps/web/app")).concat(sources(join(ROOT, "apps/web/components")))) {
  if (file === COPY_FILE) continue;
  const raw = readFileSync(file, "utf8");
  // Comments only: the literals are the point here, so `code()` is too blunt.
  const src = withoutGenerics(
    raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "));
  for (const [, , , text] of src.matchAll(SPEAKING_ATTRS)) {
    fail(file, `${JSON.stringify(text)} — words a person reads live in lib/copy.ts (ADR-0033)`);
  }
  for (const [, text] of src.matchAll(JSX_TEXT)) {
    const said = text.trim();
    // An entity (&rsquo;) or a lone symbol is punctuation around an expression,
    // not a sentence — `{copy.split.rest}</button>` must not read as one.
    if (said.length < 3 || !/[A-Za-z]{2}/.test(said) || /^&\w+;$/.test(said)) continue;
    if (/^(import|export|from|const|let|type|interface|return|function|null|undefined)$/.test(said)) continue;
    fail(file, `${JSON.stringify(said)} — words a person reads live in lib/copy.ts (ADR-0033)`);
  }
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length
  ? `\n${problems.length} broken rule(s)`
  : "rules: core is pure, no browser dialogs, no stray copy");
process.exit(problems.length ? 1 : 0);
