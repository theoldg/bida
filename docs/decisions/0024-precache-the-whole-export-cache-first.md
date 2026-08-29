# 0024 — The service worker precaches the whole export and serves it cache-first

**Status:** Accepted · 2026-08-29

**Context.** The first service worker precached ten hand-written HTML routes and
served navigations network-first. It failed at both jobs. A static-export Next
app fetches an RSC payload — `/g.txt?id=…&_rsc=…` — on every in-app tap, and the
worker matched neither those nor the route chunks: online each tap was a network
round trip for a file already on the phone, and offline the payload fetch failed,
Next fell back to a browser navigation *to the payload URL*, and the worker
served it. Saving an expense with no signal landed you on a screenful of
`1:"$Sreact.fragment"`. The hand-written list had also drifted twice — it named a
route deleted two redesigns ago and missed five that exist.

**Decision.** Precache the entire export, and serve all of it cache-first.

- The list and a content-addressed revision are **stamped in at build time** by
  `apps/web/scripts/precache.mjs`, from the files actually on disk. No route list
  is maintained by hand, and no `CACHE_VERSION` is bumped by hand.
- A `.txt` payload is cached under its path with the query string ignored: in a
  static export a route's payload is one file, and its query is only ever app
  state.
- A *document* request for a `.txt` is always Next giving up — answer it with the
  route's own shell rather than the payload.
- `/api/*` is never cached. Dexie is the offline data layer; a second cache of
  the sync API would be a second, disagreeing source of truth.

**Cache-first is the whole point.** Everything an installed app needs is on the
device under a revision that changes with the build, so a launch and every tap
after it paint without waiting on the network. A new deploy arrives when the new
worker installs — the browser revalidates `sw.js` itself — rather than by making
every screen pay a round trip on the chance there is one.

## Consequences

- **No `skipWaiting`, no `clients.claim`.** Cache-first makes a mid-session
  activation unrecoverable rather than merely slow: activating deletes the old
  cache, and the next chunk the running page lazily asks for is gone from the
  server too. The new worker waits for the app to be closed — on a phone,
  constantly — and takes over on the next launch. A deploy is therefore visible
  one launch later, which is the price.
- The precache is the whole export, currently ~1.7MB across ~75 files. It
  installs in batches with `Promise.allSettled`, so one bad entry doesn't fail
  the install. If the export ever grows past what a phone should hold on first
  visit, split the manifest — don't go back to a hand-written list.
- `scripts/offline-check.mjs` is the regression test: it drives the real export
  in Chromium, waits for the worker, reloads once (there is no `clients.claim`),
  cuts the network and walks fourteen screens including a save. Run it after
  touching `sw.js` or adding a route.
