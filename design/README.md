# Design

## `mockups/index.html`

The approved visual design, as real HTML and CSS at real phone width. **This is
the source of truth for the app's look**, not any document describing it.

Published (viewable on a phone, which is the point):
https://claude.ai/code/artifact/5195880f-3985-4409-ac1a-854e5a756921

The file is an Artifact page fragment — it deliberately has no `<!doctype>`,
`<html>`, `<head>` or `<body>` wrapper, because those are added at publish time.
Browsers open it fine as a local file regardless.

### Using it

The token block at the top (`:root { --paper, --ink, --credit, --debit, --hl … }`)
is the canonical palette, in all three theme states. Port those values verbatim
into the app's Tailwind config and shadcn CSS variables. Don't re-pick colours by
eye from a screenshot.

The reasoning behind the direction — why a ledger, why the highlighter, why
monospaced figures — is in [../docs/design-system.md](../docs/design-system.md).

### Updating it

Edit the file, then republish **to the same URL** so the owner's link keeps
working:

> Artifact tool, `url: https://claude.ai/code/artifact/5195880f-3985-4409-ac1a-854e5a756921`

Publishing without that URL creates a second, orphaned artifact.
