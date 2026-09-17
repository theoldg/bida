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
const CACHE_NAME = `bida-shell-${REVISION}`;

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

/** The same route, still carrying the state the payload URL was asked for. */
function routeWithQuery(url) {
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const query = params.toString();
  return routeOf(url) + (query ? `?${query}` : "");
}

/**
 * The only cache this worker may read is its own, and `caches.match` is not
 * that: it searches *every* cache in the origin. There is always a moment when
 * that matters — `controllerchange` fires before this worker's `activate`
 * handler runs, so a page reloaded onto this build is fetched while the previous
 * build's cache is still there to be matched, oldest first. Unscoped, the new
 * worker answered that reload out of the old cache: an old shell, or an old
 * `/g.txt`, whose client references name chunks this build doesn't have. The
 * screen then draws with pieces of it simply missing — the bottom nav among
 * them — and stays that way until the app is launched again, because the router
 * holds the payload it was given. Scoped, a miss is a fetch for a file this
 * build still serves.
 *
 * The one exception is a page that booted on the previous build and is still
 * open (`previousFor`): it is served out of *that* build's cache, which is the
 * only place its chunks and payloads still exist.
 */
function lookup(key, cacheName = CACHE_NAME) {
  return caches.open(cacheName).then((cache) => cache.match(key, { ignoreSearch: true }));
}

/**
 * This worker activates by itself (see `install`), so pages that booted on the
 * build before it are still on screen when it takes them over. Their next tap
 * asks for that build's payload and lazily for that build's chunks — neither of
 * which is in this cache, nor on the server any more — and a new build's
 * payload handed to an old router is a group screen that turns into "No group".
 * So `activate` writes down which pages those were and keeps their build's
 * cache; until they reload (lib/update.ts sees to that) they are served from it.
 *
 * Kept in a cache as well as in memory because the browser stops an idle
 * worker whenever it likes, and a page open across that must not lose its build.
 */
const LEGACY = "bida-legacy";
let legacy;

function legacyRecord() {
  legacy ??= caches
    .open(LEGACY)
    .then((cache) => cache.match("/legacy"))
    .then((res) => (res ? res.json() : null))
    .then((rec) => (rec && rec.for === CACHE_NAME ? rec : { for: CACHE_NAME, cache: null, clients: [] }))
    .catch(() => ({ for: CACHE_NAME, cache: null, clients: [] }));
  return legacy;
}

/** The previous build's cache, if `clientId` is a page still running it. */
async function previousFor(clientId) {
  if (!clientId) return null;
  const rec = await legacyRecord();
  return rec.cache && rec.clients.includes(clientId) ? rec.cache : null;
}

async function cacheFirst(cacheKey, request, clientId) {
  const previous = await previousFor(clientId);
  if (previous) {
    const old = await lookup(cacheKey, previous);
    if (old) return old;
  }
  const cached = await lookup(cacheKey);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, res.clone());
  }
  return res;
}

/**
 * All-or-nothing, because this worker activates the moment it installs: a precache
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
        // Or the next `activate` takes this half-filled cache for the previous
        // build, and keeps it in place of the one pages are really running.
        await caches.delete(CACHE_NAME);
        throw new Error(`precache incomplete: ${missing.length} of ${ASSETS.length} missing`);
      }
      await self.skipWaiting();
    })(),
  );
  // Activate as soon as the whole build is cached, rather than waiting for the
  // last client of the origin to close. Waiting was how a phone stayed on an old
  // build indefinitely: one forgotten tab pins it, and iOS Safari keeps tabs,
  // and itself, alive across what a person thinks of as closing it. What made
  // waiting necessary — a page open across activation losing its build — is
  // answered by `previousFor` instead, and the page reloads onto the new build
  // as soon as that is harmless (lib/update.ts).
});

/**
 * `skip-waiting` is what builds before this one asked for from their update
 * offer. This worker no longer waits, so it is only ever a no-op now — kept so
 * that a page on such a build can still take a worker that is mid-install.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
  if (event.data && event.data.type === "clients" && event.ports[0]) {
    event.waitUntil(describeClients(event.source, event.ports[0]));
  }
});

/**
 * Every copy of the app open on this origin, for /diag.
 *
 * Another copy is the one thing a page cannot see from inside, and it is the
 * prime suspect for a database that stops answering: a tab or window frozen in
 * the background half way through a transaction keeps its lock, and every read
 * everywhere else queues behind it (docs/frontend.md#a-live-read-can-die).
 * Paths only — a join link's secret is in the fragment, and this report is
 * pasted into messages.
 */
async function describeClients(source, port) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  port.postMessage({
    build: REVISION,
    clients: all.map((c) => ({
      self: !!source && c.id === source.id,
      path: new URL(c.url).pathname,
      visibility: c.visibilityState,
      focused: c.focused,
      // Chrome's Page Lifecycle state, where it is exposed: "frozen" is the finding.
      lifecycle: c.lifecycleState,
    })),
  });
}

/**
 * Pages this worker's predecessor controlled are now this worker's (no
 * `clients.claim`: a first visit stays uncontrolled until its next launch, as
 * before). Keep the one previous build's cache for the
 * pages that booted on it (`previousFor`). Anything older goes: a page two
 * builds behind has had a whole deploy's worth of chances to reload.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // `caches.keys()` is in creation order, so the newest other shell cache
      // is the build these pages are running.
      const previous = keys.filter((k) => k.startsWith("bida-shell-") && k !== CACHE_NAME).pop() ?? null;
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const rec = { for: CACHE_NAME, cache: previous, clients: open.map((c) => c.id) };
      legacy = Promise.resolve(rec);
      const store = await caches.open(LEGACY);
      await store.put("/legacy", new Response(JSON.stringify(rec)));
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== previous && k !== LEGACY).map((k) => caches.delete(k)),
      );
    })(),
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
   *
   * This worker only ever sees a page it controls, and it claims no first
   * visit — so the Worker holds the same rule for the phones with no worker
   * yet (`apps/api/src/payload.ts`). Change one and change the other.
   */
  if (request.mode === "navigate" && isPayload(url)) {
    event.respondWith(
      // The query is not decoration: `?id=` is which group the screen is of,
      // so the fallback carries it across rather than landing on a bare route
      // that can only say "No group". `_rsc` is the router's own and goes.
      lookup(routeOf(url)).then((cached) => cached ?? Response.redirect(routeWithQuery(url), 302)),
    );
    return;
  }

  // Everything an installed app needs is precached under a revision that
  // changes with the build, so it is all cache-first: a launch and every tap
  // after it paint without waiting on the network, online or off. A new deploy
  // arrives when the new worker installs — the browser revalidates sw.js on
  // navigation, and lib/update.ts asks again on every resume — not by making
  // every screen pay a round trip on the chance there is one.
  if (isPayload(url)) {
    event.respondWith(cacheFirst(url.pathname, request, event.clientId));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      // `cacheFirst` only reaches the network on a miss, so the catch is a dead
      // network on a route this build hasn't cached: the app's own front door
      // is a better answer than the browser's error page.
      cacheFirst(url.pathname, request).catch(() => lookup("/")),
    );
    return;
  }

  // Hashed, immutable build output, plus icons and the manifest.
  event.respondWith(cacheFirst(request, request, event.clientId));
});
