# 0033 — Every word the app says lives in one file

**Status:** Accepted · 2026-09-03

**Context.** The owner: *"Refactor all the strings to a centralized file, paving
the way for translation. The english strings are too verbose, cut some fat."*
Copy was written where it was rendered, so no line could be seen next to the
others: three screens each had their own way of saying the phone couldn't reach
the server, one dialog said "Add member" and "Add" and "Name", and a second
language would have meant reading every `.tsx` in the app.

## Decision

- **`apps/web/lib/copy.ts` holds every string a person reads**, grouped by the
  screen or the idea it belongs to. Screens import `copy` and never hold a
  literal — including `aria-label`, `placeholder` and `title`, which are read
  aloud or shown in a blank field and are copy like any other.
- **A string that takes a value is a function there**, not a template at the
  call site: `failed: (why) => …`. Word order is the first thing a translation
  changes, so the whole sentence has to be in the file being translated.
- **Counts go through `plural(n, noun)`** with a `{ one, many }` noun, never
  `${n}s`. English is the only language where that suffix works.
- **`scripts/rules-check.mjs` fails a build that puts a literal back** — text
  between JSX tags, and those three attributes. It is a fence, not a type
  system: a string handed to some other prop is still on review to catch.
- **A second language is a second object of the same shape**, and nothing else.
  No framework, no message ids, no extraction step, and no runtime locale switch
  until there is a second language to switch to.

## Consequences

- The app's voice is legible for the first time, which is what made cutting it
  possible: the sentences were shortened in the move, not after it.
- One import appears in nearly every screen. That is the cost, and it is the
  same import every time.
- `SPLIT_MODE_LABEL`, `ENTRY_LABEL`, `ENTRY_VERB`, `ENTRY_PAYER_LABEL` and
  `ENTRY_SPLIT_LABEL` are gone from `lib/`; `lib/entry-kind.ts` is now types and
  arithmetic only.
- Tests that assert wording (`lib/format.test.ts`, `lib/history-copy.test.ts`)
  still assert the sentence, not the key — so a careless edit to `copy.ts` fails
  a test rather than shipping.

## Rejected

- **An i18n library** — a dependency and a migration on a project with no team,
  bought before there is a second language. If one ever earns its place, it
  consumes this file.
- **A string per component, colocated** — that is what we had. It reads well one
  file at a time and produces four ways to say the same thing.
- **Flat keys** (`group.offline.idle` as a string map) — nesting is the same
  thing with types, autocompletion, and a compiler error when a screen asks for
  a sentence that isn't there.
