# 0004 — Static export, secrets in the URL fragment

**Status:** Accepted · 2026-08-27
**Note (2026-08-27):** The routing table below and the "client state within
`/g`, rendered as drawers and sheets" sentence are superseded by
[0007](0007-per-screen-routes-not-drawers.md) — each screen is its own static
route instead. The fragment-secret decision on this page is unchanged and
still governs.

## Context

Next.js was a requirement. But the app is local-first: the client already holds
the data in IndexedDB, so server rendering would mean fetching everything twice
and would break the moment the device goes offline.

That points at `output: 'export'` — but a static export cannot generate a page
for a group id that doesn't exist at build time, which is exactly what a route
like `/g/[groupId]` needs.

Separately, [0003](0003-link-only-access.md) needs the group secret to reach the
client without ever reaching a server log.

## Decision

Both problems have the same answer. **The group id and secret both live in the
URL fragment**, and the only routes are static:

```
/                     groups list
/g#<groupId>.<secret> the group view
/join#<groupId>.<secret>
/settings
```

Fragments are never transmitted to a server, so `/g` is a single static page and
the secret never leaves the browser. Everything inside a group — expense detail,
add expense, split editor, history — is client state within `/g`, rendered as
drawers and sheets, matching both the mockups and how the app is used one-handed.

## Consequences

- Full static export: no server runtime for the app at all, no SSR/CSR split,
  no hydration mismatch, instant loads from the edge, trivially offline-capable.
- The secret is structurally incapable of appearing in an access log, a `Referer`
  header, or an analytics payload.
- **No deep links to a single expense.** Links address groups only — which is
  what Tricount does too, and what people actually share.
- `output: 'export'` forbids route handlers, `next/image` optimisation, ISR,
  middleware, and dynamic route params. Nothing in the MVP wants them.
- Anything requiring the fragment must run client-side; the first paint of `/g`
  is a skeleton until the fragment is read.

## Rejected

- **`@opennextjs/cloudflare`** — supports the full Next.js feature set including
  dynamic routes, at the cost of a Worker invocation per request, a much larger
  bundle, build-time environment-variable friction, and an adapter between us and
  the framework. Nothing in the MVP earns it.
- **SPA fallback + a catch-all route** — makes `/g/<id>` work by serving the
  shell for unknown paths, but it's a hack that fights the App Router, and it
  would put the secret in the path.

## Revisit if

We need server-rendered public pages (a read-only shared summary, link previews)
or true deep links. Then OpenNext becomes the right call — as a new ADR.
