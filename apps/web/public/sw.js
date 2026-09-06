/**
 * App-shell precache — never the API. Dexie is the offline data layer; caching
 * `/api/*` here would be a second, disagreeing source of truth.
 * See docs/frontend.md#pwa.
 *
 * Both lists below are stamped in by `scripts/precache.mjs` after the export is
 * written, from the files actually on disk. Don't edit them, and don't add a
 * hand-maintained route list back: the last one drifted from the app twice over.
 */
const REVISION = "__PRECACHE_REVISION__";
const ASSETS = ["__PRECACHE_ASSETS__"];
const CACHE_NAME = `hajsik-shell-${REVISION}`;

/**
 * Next fetches an RSC payload — `/g.txt?id=…&_rsc=…` — on every in-app tap, and
 * a static export's payload for a route is one file whose query string is only
 * ever app state. Match on the path alone and the whole app navigates from
 * cache; miss them, as the first version of this file did, and every tap is a
 * network round trip that fails outright on a train.
 */
function isPayload(url) {
  return url.pathname.endsWith(".txt");
}

/** `/g.txt` is the payload for `/g`. Nothing else in the export ends in .txt. */
function routeOf(url) {
  return url.pathname.slice(0, -".txt".length) || "/";
}

/**
 * The manifest, and only the manifest. Everything else here is cache-first,
 * which is right for anything the app paints with — but this file is not read
 * by the app at all. It is read by the *browser*, once a day, to decide whether
 * to re-mint the installed Android app (display mode, icons, colours are baked
 * into a WebAPK at install time). Cache-first meant that check saw our own
 * stale copy and concluded nothing had changed, so a manifest edit could not
 * reach an installed phone until a whole service-worker cycle had turned over
 * first — and then only at the next daily check. Small file, read rarely, and
 * the cache is still there for a check that happens offline.
 */
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request.url, res.clone());
      return res;
    }
  } catch { /* offline — the precached copy below is the answer */ }
  return (await caches.match(request.url, { ignoreSearch: true })) ?? fetch(request);
}

async function cacheFirst(cacheKey, request) {
  const cached = await caches.match(cacheKey, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, res.clone());
  }
  return res;
}

/**
 * All-or-nothing, because `activate` deletes the previous cache: a precache
 * with holes replaces a complete one, and the installed app is then a build
 * that can't finish painting itself with no signal. Which is the likely case —
 * the update runs on whatever mobile data the phone had when it was last
 * opened. So: batches (a few hundred parallel requests shouldn't stall the
 * phone), one retry for the stragglers, then throw. A failed install leaves the
 * running worker and its intact cache alone, and the browser tries again later.
 */
async function addAll(cache, urls) {
  const failed = [];
  for (let i = 0; i < urls.length; i += 12) {
    const batch = urls.slice(i, i + 12);
    const results = await Promise.allSettled(batch.map((url) => cache.add(url)));
    results.forEach((r, j) => r.status === "rejected" && failed.push(batch[j]));
  }
  return failed;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const missing = await addAll(cache, await addAll(cache, ASSETS));
      if (missing.length) {
        throw new Error(`precache incomplete: ${missing.length} of ${ASSETS.length} missing`);
      }
    })(),
  );
  // Deliberately no `skipWaiting`. Serving the shell from cache is only safe if
  // a running page can't have its build deleted out from under it: activating
  // mid-session drops the old cache, and the next lazily-loaded chunk that page
  // asks for is gone from the server too. So the new worker waits for the last
  // client of the origin to close — and "on a phone that is constantly" is the
  // one thing this file got wrong. One forgotten browser tab on the same origin
  // is a client, and it pins the old build for as long as it lives. The waiting
  // worker is offered to the person instead, by lib/update.ts and the `message`
  // handler below.
});

/**
 * The one way this worker activates early, and it is never the worker's own
 * idea. `install` deliberately doesn't call `skipWaiting` — see above — because
 * the page whose cache it would delete is still on screen. This message says
 * that page has volunteered to go: `applyUpdate` in lib/update.ts sends it and
 * reloads on `controllerchange`, so by the time the old cache is gone there is
 * nothing left that needed it.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never the API — Dexie owns offline data

  /**
   * Offline, Next's router gives up on a failed payload fetch and hands the
   * *payload* URL to the browser as a navigation. Served literally that is a
   * screenful of `1:"$Sreact.fragment"` — which is what saving an expense
   * offline used to show. A document request for a payload is always a mistake:
   * answer it with the route's own shell.
   */
  if (request.mode === "navigate" && isPayload(url)) {
    event.respondWith(
      caches.match(routeOf(url), { ignoreSearch: true })
        .then((cached) => cached ?? Response.redirect(routeOf(url), 302)),
    );
    return;
  }

  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything an installed app needs is precached under a revision that
  // changes with the build, so it is all cache-first: a launch and every tap
  // after it paint without waiting on the network, online or off. A new deploy
  // arrives when the new worker installs — the browser revalidates sw.js
  // itself — not by making every screen pay a round trip on the chance there is
  // one.
  if (isPayload(url)) {
    event.respondWith(cacheFirst(url.pathname, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      cacheFirst(url.pathname, request).catch(() =>
        caches.match(url.pathname, { ignoreSearch: true }).then((c) => c ?? caches.match("/")),
      ),
    );
    return;
  }

  // Hashed, immutable build output, plus the icons.
  event.respondWith(cacheFirst(request, request));
});
