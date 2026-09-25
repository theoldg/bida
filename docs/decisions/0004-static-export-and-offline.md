# 0004 — A static export: the secret in the fragment, the whole thing precached

**Status:** Accepted · 2026-08-27 · offline 2026-08-29 · updates 2026-09-17

**Context.** Next.js was a requirement, but the app is local-first: server
rendering would fetch everything twice and break offline. That points at
`output: 'export'` — which cannot generate a page for a group id that doesn't
exist at build time. Separately, [0003](0003-link-only-access.md) needs the
secret to reach the client without ever reaching a server log, and an installed
app has to paint with no signal at all.

## Decision

**The group id and secret live in the URL fragment**, which is never transmitted
to a server. Every route is static and known at build time.

**The service worker precaches the entire export and serves all of it
cache-first** — so a launch and every tap after it paint without the network.

- The file list and a content-addressed revision are **stamped in at build time**
  by `apps/web/scripts/precache.mjs`, from what is actually on disk. The
  hand-written list this replaced had drifted twice.
- A `.txt` RSC payload is cached under its path with the query ignored: in a
  static export a route's payload is one file, and its query is only app state.
  A *document* request for a `.txt` is Next giving up — answer it with the
  route's own shell, or the user lands on a screenful of `1:"$Sreact.fragment"`.
- `/api/*` is never cached. Dexie is the offline data layer; a second cache of
  the sync API would be a second, disagreeing source of truth.

## Consequences

- No server runtime, no SSR/CSR split, instant edge loads. The secret is
  structurally incapable of appearing in an access log or a `Referer` header.
- **No deep links to a single expense** — links address groups only, which is
  what Tricount does and what people actually share. `output: 'export'` also
  forbids route handlers, `next/image` optimisation, ISR, middleware and dynamic
  params; nothing in the MVP wants them.
- **The worker activates itself as soon as a build is fully precached**, and
  keeps the previous build's cache for the pages still running it. Cache-first
  makes a bare mid-session activation unrecoverable — the old page's next chunk
  or payload is gone from the server too — so the first answer was to wait for
  the last client to close and offer a Reload tap. On iOS Safari that client
  essentially never closes, and people killed the browser repeatedly to get a
  deploy. Keeping one old cache (a few MB) is the price of taking updates
  eagerly; the page reloads itself onto the new build as soon as that is
  harmless ([pwa.md](../pwa.md)).
- The precache is all-or-nothing — one retry for stragglers, then the install
  fails and the old worker keeps running. A partial cache would strand an
  installed app on a build it can't paint, and a failed install deletes its own
  half-filled cache so the next `activate` can't mistake it for the previous build. If the export outgrows what a phone
  should hold on first visit, split the manifest; don't go back to a hand list.
- `scripts/offline-check.mjs` is the regression test — run it after touching
  `sw.js`.

## Rejected

- **`@opennextjs/cloudflare`** — full Next.js feature set, at the cost of a
  Worker invocation per request and an adapter between us and the framework.
- **SPA fallback + catch-all route** — fights the App Router and puts the secret
  in the path.
- **Network-first navigations** — pays a round trip on every tap for the chance
  a deploy happened.

**Revisit if** we need server-rendered public pages or true deep links. Then
OpenNext becomes right — as a new ADR.
