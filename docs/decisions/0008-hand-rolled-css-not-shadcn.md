# 0008 — Hand-rolled components from the mockup, not shadcn/ui

**Status:** Accepted · 2026-08-27

## Context

The original plan (`CLAUDE.md`, `docs/frontend.md`, `docs/design-system.md`)
was shadcn/ui: copy in primitives as needed, and port the mockup's `:root`
token block onto shadcn's own CSS variable names.

Building the actual screens in Phase 2, no shadcn primitive was ever copied in
and no `shadcn add` was ever run. `apps/web/components/` holds four hand-rolled
files (`chrome.tsx`, `bits.tsx`, `icons.tsx`, `theme.tsx`) built directly from
`design/mockups/index.html`'s HTML and CSS, and `apps/web/package.json` carries
no shadcn or Radix dependency at all.

This happened because the mockup's markup and class names were already
finished, specific, and directly portable — every screen has a 1:1 correspondence
with a mockup section — so copying a shadcn primitive and then re-skinning it
to match would have been strictly more work than lifting the mockup's own
markup, and would have fought shadcn's own default structure and class names in
the process (the exact friction `design-system.md`'s "map our tokens onto
shadcn's variable names" guidance was trying to pre-empt).

## Decision

**Components are hand-rolled, ported directly from the mockup's HTML and CSS.**
No shadcn/ui, no Radix, no headless-UI-primitive dependency of any kind. The
mockup's own class names and token variables (`--paper`, `--ink`, `--brand`,
`--credit`, `--debit`, `--hl`, …) are used verbatim, not remapped onto a
component library's naming scheme.

`design/mockups/index.html` remains the single source of truth for markup and
styling, same as before — this ADR only removes the shadcn indirection between
the mockup and the shipped component.

## Consequences

- One fewer dependency, consistent with `CLAUDE.md`'s "prefer none" stance —
  no `components.json`, no shadcn CLI, no Radix primitives to keep patched.
- Full control over markup and CSS with nothing to override or fight; a mockup
  change ports directly.
- Accessibility behaviour (focus trapping, `aria-*` wiring, keyboard nav for
  menus/dialogs) that shadcn/Radix would have given for free now has to be
  built and tested by hand wherever it's needed.
- `docs/frontend.md` and `docs/design-system.md`'s shadcn-specific guidance
  (mapping tokens onto shadcn's variable names, "future `shadcn add` runs")
  no longer applies and is corrected alongside this ADR.

## Rejected

- **Adopt shadcn as originally planned, re-skin its primitives** — rejected in
  practice by every screen built so far; revisit only if a future screen needs
  behaviour (a real popover, a combobox) that hand-rolling would make
  genuinely hard to get right.

## Revisit if

A screen needs a primitive with real accessibility complexity behind it (a
combobox, a date picker, a popover with focus management) that isn't worth
hand-building. At that point pulling in one shadcn primitive for just that
component is reasonable — it doesn't require reversing this ADR, just noting
the exception where it happens.
