# 0023 — One monospace face, and colour only on money

**Status:** Accepted · 2026-08-29 · supersedes the "accounting ledger" direction
in [design-system.md](../design-system.md)

**Context.** The original direction was a paper accounting ledger: warm
green-biased grounds, three typefaces (Bricolage Grotesque display, Karla body,
IBM Plex Mono figures), an amber highlighter for personal mode, six per-member
avatar tints, a teal `--brand`, pill radii and drop shadows. It worked, but it
spent colour everywhere — by the balances screen a row could carry a brand teal,
an amber wash, an avatar tint and a credit green at once, which is four colour
systems arguing about which one you should read. The owner asked for the
opposite: a minimal monospace look, with "basically only subtle green and red
for the balances."

**Decision.** One typeface — JetBrains Mono — for headings, prose and figures
alike; hierarchy is weight and tracking, never family. Grounds are plain
near-neutral greys in both themes. Radii are 2–4px and shadows are hairline
rings, not blurs. Exactly two hues exist: `--credit` green and `--debit` red,
and they are spent only on money. Everything else — the primary button, the
active tab, the focus ring, the personal-mode highlighter, every avatar — is
drawn in ink, a ground, or a rule.

## Consequences

- `--brand` collapses into `--ink`. A primary button is figure-ground inversion
  (ink block, paper glyph) rather than a tinted one, and "tappable" is now
  carried by weight, inversion or an underline. Any future accent colour is a
  regression, not an addition.
- Per-member avatar tints are gone, and with them `tone()` in
  `apps/web/lib/format.ts`. Monospaced initials plus the printed name do the
  identifying; the six tints were decoration that read as meaning.
- The highlighter is a neutral wash. Personal mode's colour now comes only from
  the signed per-row figure and its left edge bar, which is the one place the
  colour was ever load-bearing. Sync-pending still carries a dot and a banner.
- Body text is a monospace at 14px, so it sets wider: titles truncate a word
  earlier and long labels have less room. That is the cost of the look, paid
  deliberately.
- The mockup and `globals.css` both changed; they still have to match.
