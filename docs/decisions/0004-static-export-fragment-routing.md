# 0004 — Static export, secrets in the URL fragment

**Status:** Accepted · 2026-08-27
**Note:** the routing plan below — everything inside `/g` as client state
rendered in drawers and sheets — is superseded by
[0007](0007-per-screen-routes-not-drawers.md). **The fragment-secret decision is
unchanged and still governs.**

**Context.** Next.js was a requirement, but the app is local-first: server
rendering would fetch everything twice and break offline. That points at
`output: 'export'` — which cannot generate a page for a group id that doesn't
exist at build time, exactly what `/g/[groupId]` needs. Separately,
[0003](0003-link-only-access.md) needs the secret to reach the client without
ever reaching a server log.

**Decision.** Both problems have one answer: **the group id and secret live in
the URL fragment**, and the only routes are static (`/`, `/g`, `/join`,
`/settings`). Fragments are never transmitted to a server.

## Consequences

- Full static export: no server runtime for the app, no SSR/CSR split, no
  hydration mismatch, instant edge loads, trivially offline-capable.
- The secret is structurally incapable of appearing in an access log, a
  `Referer` header, or an analytics payload.
- **No deep links to a single expense.** Links address groups only — which is
  what Tricount does and what people actually share.
- `output: 'export'` forbids route handlers, `next/image` optimisation, ISR,
  middleware and dynamic params. Nothing in the MVP wants them.
- Anything needing the fragment runs client-side, so `/g`'s first paint is a
  skeleton until the fragment is read.

## Rejected

- **`@opennextjs/cloudflare`** — full Next.js feature set, at the cost of a
  Worker invocation per request, a much larger bundle, build-time env friction
  and an adapter between us and the framework. Nothing in the MVP earns it.
- **SPA fallback + catch-all route** — fights the App Router and puts the secret
  in the path.

**Revisit if** we need server-rendered public pages (a read-only summary, link
previews) or true deep links. Then OpenNext becomes right — as a new ADR.
