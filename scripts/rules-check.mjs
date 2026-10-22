#!/usr/bin/env node
/**
 * `pnpm rules` — the rules the docs state, checked against the code. The bar for
 * adding one: written down as a decision, reversible by a single line, and no
 * test would notice. Style is not on this list.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { ROOT } from "./lib/together.mjs";
const SKIP = new Set(["node_modules", ".next", "out", ".git", "dist"]);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [path] : [];
  });
}

/** So a rule matches code and not the prose explaining why it exists. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ")
  .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

const problems = [];
const fail = (file, rule) => problems.push(`${relative(ROOT, file)}\n        ${rule}`);

// CLAUDE.md: core is pure — no I/O, no framework, its clock an argument.
for (const file of sources(join(ROOT, "packages/core/src"))) {
  const raw = readFileSync(file, "utf8");
  const src = code(raw);
  // From the raw source: `code()` has blanked the import specifier.
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

// docs/invariants.md: a screen takes its verdict from the registry
// (`data.guard`), which can't be declared without a repair. It may ask what to
// *name* (`entriesInvolving`), never whether to refuse.
for (const file of sources(join(ROOT, "apps/web"))) {
  const src = code(readFileSync(file, "utf8"));
  if (/\bmemberInvolved\b/.test(src)) {
    fail(file, "calls `memberInvolved` — a refusal comes from `data.guard`, so it "
      + "cannot outlive its healer (docs/invariants.md)");
  }
}

// docs/live-reads.md#a-live-read-can-die: a direct `useLiveQuery` has no
// watchdog, so it is the screen left on skeleton rows when the database stalls.
for (const file of sources(join(ROOT, "apps/web"))) {
  if (file.endsWith(join("lib", "db", "live.ts"))) continue;
  if (/\buseLiveQuery\b/.test(code(readFileSync(file, "utf8")))) {
    fail(file, "calls `useLiveQuery` — read through `useLive`, which notices a read that "
      + "never answers (docs/live-reads.md#a-live-read-can-die)");
  }
}

// ADR-0016: only `receiptBill` and `savedBill` know the seed the leftover cents
// fall by, so a screen asking `receiptBreakdown` prices the bill a cent away.
for (const file of sources(join(ROOT, "apps/web/app")).concat(sources(join(ROOT, "apps/web/components")))) {
  const src = code(readFileSync(file, "utf8"));
  if (/\breceiptBreakdown\b/.test(src)) {
    fail(file, "calls `receiptBreakdown` — a bill is priced through `receiptBill` or `savedBill`, "
      + "the only things that may name a tiebreak seed (docs/who-had-what.md)");
  }
}

/**
 * docs/sync.md#the-demo-group-has-no-key: a single `groupKeys.put` for the demo
 * id would make every tourist a D1 writer. So exactly one file may *create* a key
 * row, and it refuses the demo id; `lib/db/sync.ts` only updates rows it read.
 */
{
  const KEY_WRITER = join(ROOT, "apps/web/lib/db/commands/groups.ts");
  const KEY_UPDATER = join(ROOT, "apps/web/lib/db/sync.ts");
  for (const file of sources(join(ROOT, "apps/web"))) {
    if (file === KEY_WRITER || file === KEY_UPDATER) continue;
    if (/\bgroupKeys\.put\b/.test(code(readFileSync(file, "utf8")))) {
      fail(file, "writes a `groupKeys` row — key rows are written by `saveGroupKey` alone, "
        + "which is what keeps the demo group unable to sync (docs/sync.md#the-demo-group-has-no-key)");
    }
  }
  if (!/\bisDemo\b/.test(code(readFileSync(KEY_WRITER, "utf8")))) {
    fail(KEY_WRITER, "`saveGroupKey` no longer refuses the demo id — a key row is the one "
      + "thing that would let the demo reach the server (docs/sync.md#the-demo-group-has-no-key)");
  }
}

/**
 * docs/navigation.md#routing: `data.group` is `undefined` both while reading and
 * when absent, so a screen left to its loading branch is a back arrow over
 * nothing.
 */
for (const file of sources(join(ROOT, "apps/web/app/g"))) {
  if (!file.endsWith(join("page.tsx"))) continue;
  if (!/<BadLink\b/.test(code(readFileSync(file, "utf8")))) {
    fail(file, "renders no `BadLink` — every screen under `/g` validates its `id`, or a "
      + "link to a group this phone hasn't got is a blank that never fills "
      + "(docs/navigation.md#routing)");
  }
}

// ADR-0007: Safari reports any back inside a tap as the device's button, so a
// bare one is answered by the press guard. `goBack` takes the replace too, for a
// swallowed traversal (docs/navigation.md#keeping-the-devices-back-honest).
for (const file of sources(join(ROOT, "apps/web"))) {
  if (file.endsWith(join("lib", "nav.ts"))) continue;
  const src = code(readFileSync(file, "utf8"))
    .replace(/goBack\(\(\)\s*=>\s*router\.back\(\),\s*\(to\)\s*=>\s*router\.replace\(to\)\)/g, "");
  if (/\brouter\.back\s*\(|\bhistory\.(back|go)\s*\(|\bnavigation\.(back|traverseTo)\s*\(/.test(src)) {
    fail(file, "goes back directly — use `goUp`, or `goBack(() => router.back(), "
      + "(to) => router.replace(to))`, from lib/nav.ts: Safari mistakes a bare one for "
      + "the device's back button, and an exit that hands over no replace cannot be "
      + "repaired when Android swallows the traversal (ADR-0007)");
  }
}

/**
 * docs/import-export.md#the-clipboard: `navigator.clipboard` can be `undefined`,
 * so a bare call throws — on the in-app-browser screen, outside the error
 * boundary. One door for writing (`lib/clipboard.ts`), one for reading
 * (`lib/paste.ts`).
 */
{
  const DOORS = ["apps/web/lib/clipboard.ts", "apps/web/lib/paste.ts"].map((p) => join(ROOT, p));
  for (const file of sources(join(ROOT, "apps/web"))) {
    if (DOORS.includes(file)) continue;
    if (/navigator\s*\.\s*clipboard/.test(code(readFileSync(file, "utf8")))) {
      fail(file, "reaches `navigator.clipboard` directly — write through "
        + "`writeClipboardText` (lib/clipboard.ts), or a browser without a clipboard "
        + "throws where a refusal was expected (docs/import-export.md#the-clipboard)");
    }
  }
}

// docs/design-system.md#rules-that-are-not-negotiable: the phone's autofill
// offering a saved address under a field is a web page showing through.
for (const file of sources(join(ROOT, "apps/web"))) {
  // Raw: `code()` blanks the type, and a file picker has nothing to fill.
  for (const [tag] of readFileSync(file, "utf8").matchAll(/<input\b[\s\S]*?\/>/g)) {
    if (!/\bautoComplete=\{NO_AUTOFILL\}/.test(tag) && !/\btype="file"/.test(tag)) {
      fail(file, "an `<input>` without `autoComplete={NO_AUTOFILL}` (lib/autofill.ts) — Chrome "
        + "fills past \"off\", and the phone offers its saved names and addresses "
        + "(docs/design-system.md#rules-that-are-not-negotiable)");
    }
  }
}

// ADR-0008: asking is components/dialog.tsx, never a browser dialog.
for (const file of sources(join(ROOT, "apps/web"))) {
  const src = code(readFileSync(file, "utf8"));
  // A call, not a DOM interface's declaration.
  for (const [, call] of src.matchAll(/(?:^|[^.\w])\b(prompt|confirm|alert)\s*\((?!\s*\)\s*:)/g)) {
    fail(file, `\`${call}()\` — no browser dialogs; ask with components/dialog.tsx (ADR-0008)`);
  }
  if (/<select[\s>]/.test(src)) fail(file, "`<select>` — every picker is our own ChoiceDialog (ADR-0008)");
}

/**
 * Every word a person reads lives in `apps/web/lib/copy.ts` (ADR-0033). Text
 * between JSX tags and the three attributes read aloud are findable without a
 * parser; a string passed to a prop is left to review.
 */
const COPY_FILE = join(ROOT, "apps/web/lib/copy.ts");
const SPEAKING_ATTRS = /\b(aria-label|placeholder|title)=(["'])([^"'{}]*[A-Za-z]{2}[^"'{}]*)\2/g;
const JSX_TEXT = />([^<>{}=()[\];:`$]*?[A-Za-z]{2}[^<>{}=()[\];:`$]*?)</g;

/** A generic's `>` is not a tag's. Dropped innermost-first. */
function withoutGenerics(src) {
  let out = src, prev;
  do { prev = out; out = out.replace(/(?<=[\w$])<[^<>]*>/g, ""); } while (out !== prev);
  return out;
}

for (const file of sources(join(ROOT, "apps/web/app")).concat(sources(join(ROOT, "apps/web/components")))) {
  if (file === COPY_FILE) continue;
  const raw = readFileSync(file, "utf8");
  const src = withoutGenerics(
    raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "));
  for (const [, , , text] of src.matchAll(SPEAKING_ATTRS)) {
    fail(file, `${JSON.stringify(text)} — words a person reads live in lib/copy.ts (ADR-0033)`);
  }
  for (const [, text] of src.matchAll(JSX_TEXT)) {
    const said = text.trim();
    // An entity or a lone symbol is punctuation around an expression.
    if (said.length < 3 || /^&\w+;$/.test(said)) continue;
    if (/^(import|export|from|const|let|type|interface|return|function|null|undefined)$/.test(said)) continue;
    fail(file, `${JSON.stringify(said)} — words a person reads live in lib/copy.ts (ADR-0033)`);
  }
}

// A server page is prerendered once, in English, and never drawn again on the
// phone, so the language switch can't reach it (frontend.md). A layout may
// still read `copy` for its metadata, which is the link preview's.
for (const file of sources(join(ROOT, "apps/web/app"))) {
  if (file.endsWith("layout.tsx")) continue;
  if (!/^\s*["']use client["']/.test(readFileSync(file, "utf8").replace(/^(\s*\/\/.*\n)*/, ""))) {
    fail(file, `not "use client" — a server page stays in English whatever the language (frontend.md)`);
  }
}

// No em dashes in the copy, permanently — the owner's call: they read as
// LLM-written. A literal that is only the dash is `copy.none`.
for (const file of [COPY_FILE, join(ROOT, "apps/web/lib/copy-pl.ts")]) {
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/\/\/.*$/gm, "");
  src.split("\n").forEach((line, i) => {
    if (line.replace(/(["'`])—\1/g, "").includes("—")) {
      fail(file, `line ${i + 1}: an em dash in copy — use a full stop, comma or colon (owner, 2026-09-17)`);
    }
  });
}

for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length
  ? `\n${problems.length} broken rule(s)`
  : "rules: core is pure, refusals come from the registry, a bill is priced in one place, "
    + "every live read watched, every /g screen checks its id, the demo holds no key, "
    + "back goes through nav, one door to the clipboard, no browser dialogs, "
    + "no stray copy, no server page, no em dash in copy, no autofill");
process.exit(problems.length ? 1 : 0);
