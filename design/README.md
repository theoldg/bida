# Design

`mockups/index.html` is the proposed visual design as real HTML and CSS at phone
width, and **the source of truth for the app's look** — not any document
describing it. Published (viewable on a phone, which is the point):
https://claude.ai/code/artifact/5195880f-3985-4409-ac1a-854e5a756921

The token block at the top (`:root { --paper, --ink, --credit, --debit, --hl … }`)
is the canonical palette in all three theme states. Port those values verbatim
into `apps/web/app/globals.css`; don't re-pick colours by eye from a screenshot.
The reasoning behind the direction is in
[../docs/design-system.md](../docs/design-system.md).

The file is an Artifact page fragment — no `<!doctype>`, `<html>`, `<head>` or
`<body>` wrapper, because those are added at publish time. Browsers open it fine
as a local file regardless.

**Updating it:** edit, then republish **to the same URL** (Artifact tool, `url:`
the link above) so the owner's link keeps working. Publishing without the URL
creates a second, orphaned artifact.
