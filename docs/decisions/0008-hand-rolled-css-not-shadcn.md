# 0008 — Hand-rolled components from the mockup, not shadcn/ui

**Status:** Accepted · 2026-08-27

**Context.** The original plan was shadcn/ui: copy in primitives as needed and
port the mockup's `:root` token block onto shadcn's variable names. Building the
actual screens, no primitive was ever copied in and `shadcn add` was never run —
`apps/web/components/` is hand-rolled files built directly from
`design/mockups/index.html`, and `package.json` carries no shadcn or Radix
dependency. The mockup's markup and class names were already finished, specific
and directly portable, so copying a primitive and re-skinning it would have been
strictly more work than porting the markup.

**Decision.** Ratify what happened. Components are hand-rolled from the mockup's
own HTML, CSS and token names (`--paper`, `--ink`, `--brand`, …) used verbatim,
not remapped. No shadcn, no Radix, no UI library.

## Consequences

- One fewer dependency tree on a project whose stated policy is to prefer none,
  and one fewer thing to migrate over a long life.
- The mockup stays literally the source of truth: a screen and its mockup
  section share class names, so drift is visible.
- **We give up shadcn's accessibility work** on the primitives it would have
  provided (focus traps, dialog semantics, keyboard handling). Anything
  interactive we hand-roll has to get roles, focus and keyboard behaviour right
  itself — and the app has few such primitives by design.
- A future need for a genuinely hard primitive (a combobox, a date picker) can
  pull in one headless library for that alone, without adopting a design system.

## Rejected

- **Adopt shadcn now and re-skin it.** More work than porting finished markup,
  and it would put a component library's variable names between the mockup and
  the app.

**Revisit if** a screen needs a primitive with real accessibility complexity (a
combobox, a date picker, a popover with focus management). Pulling in that one
primitive is reasonable and doesn't reverse this ADR — just note the exception
where it happens.
