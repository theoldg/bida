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

/**
 * `/g.txt` is the payload for `/g`. Nothing else in the export ends in .txt.
 *
 * The root's is `/index.txt`, which is not `/index`: that route does not exist,
 * and a redirect to it is a 404 where the groups list should be. The Worker
 * holds the same rule for phones with no worker yet (`apps/api/src/payload.ts`).
 */
function routeOf(url) {
  const path = url.pathname.slice(0, -".txt".length);
  return path === "/index" ? "/" : path || "/";
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
 * This worker activates by itself (see `install`), so pages that booted on an
 * earlier build are still on screen when it takes them over. Their next tap
 * asks for that build's payload and lazily for that build's chunks — neither of
 * which is in this cache, nor on the server any more — and a new build's
 * payload handed to an old router is a group screen that turns into "No group".
 * So `activate` writes down which build each open page is running, and keeps
 * every cache still spoken for; until they reload (lib/update.ts sees to that)
 * they are served from their own.
 *
 * **Which build each page is on, not just "the previous one".** This used to
 * keep one cache — the newest other — and hand it to every page open at the
 * time. That is right exactly once. At the deploy after, the page that was
 * running the build before last had its cache deleted under it and was pointed
 * at a build it had never run: chunk names are content-hashed and simply miss,
 * but `/g` and `/g.txt` are not, so it was served a stranger's payload. Two
 * deploys with one page left open was a screen that could not finish drawing.
 * Carrying the record forward instead costs at most one kept cache per window
 * left open, and a window that closes takes its cache with it at the next
 * activate.
 *
 * Kept in a cache as well as in memory because the browser stops an idle
 * worker whenever it likes, and a page open across that must not lose its build.
 */
const LEGACY = "bida-legacy";
/** `{ builds: { [clientId]: cacheName } }` — every open page not on this build. */
let legacy;

function readRecord() {
  return caches
    .open(LEGACY)
    .then((cache) => cache.match("/legacy"))
    .then((res) => (res ? res.json() : null))
    .then((rec) => (rec && rec.builds ? rec : { builds: {} }))
    .catch(() => ({ builds: {} }));
}

function legacyRecord() {
  legacy ??= readRecord();
  return legacy;
}

/**
 * Which build `clientId` is running, as a cache to answer it from:
 *
 * - a cache name — an earlier build, still here to be served from;
 * - `null` — an earlier build whose cache has gone;
 * - `undefined` — this build, or a page we have never met.
 *
 * The middle one is not the same as the last, and reading it as such is what
 * `payloadFor` is about.
 */
async function previousFor(clientId) {
  if (!clientId) return undefined;
  const { builds } = await legacyRecord();
  const cache = builds[clientId];
  if (cache === undefined || cache === CACHE_NAME) return undefined;
  return cache;
}

/**
 * A payload, for a page that may not be on this build.
 *
 * Next reads the build id out of every payload it is handed, and when it is not
 * its own it stops routing and hard-navigates — to **`res.url`**, to take the
 * new build. For anything out of a cache that URL is the cache key, and
 * payloads are keyed by path (the query on one is only ever app state, so one
 * file answers every `?id=`). So the group the screen was of is gone before the
 * browser sees it: what loads is a bare `/g/...`, every screen under `/g` reads
 * its group out of the query, and all any of them can say is that the link is
 * missing its password. That is the report this was found in — a tap during a
 * deploy, on a phone that had done nothing wrong.
 *
 * A page on an earlier build is served that build's payload, as before. What is
 * new is the case where that cache has gone: rather than fall through and hand
 * it this build's, **fail**. Of the three ways the router gives up, its `catch`
 * is the only one that falls back to the URL *it asked for* rather than the one
 * it was answered from (`fetch-server-response.js`) — so the query survives,
 * and the navigate branch below turns that `.txt` back into the route. A
 * redirect here cannot do the same job: `fetch` follows it, and what it lands on
 * is another cache key with no query on it either.
 */
async function payloadFor(url, request, clientId) {
  const previous = await previousFor(clientId);
  if (previous !== undefined) {
    const own = previous && (await lookup(url.pathname, previous));
    return own || Response.error();
  }
  return cacheFirst(url.pathname, request, clientId);
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
 * before). Note which build each open page is running and keep those caches;
 * everything nothing is running goes.
 *
 * A page this worker has met before keeps the build it was already known by,
 * however many deploys ago that was — carrying the record forward is the whole
 * point of it. Only a page being met for the first time is assumed to be on
 * the build that came immediately before, which is the best guess there is.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const [keys, open, before] = await Promise.all([
        caches.keys(),
        self.clients.matchAll({ type: "window", includeUncontrolled: true }),
        readRecord(),
      ]);
      // `caches.keys()` is in creation order, so the newest other shell cache
      // is the build a page we have not seen before is most likely running.
      const newest = keys.filter((k) => k.startsWith("bida-shell-") && k !== CACHE_NAME).pop() ?? null;
      const builds = {};
      // Every window open *now* booted before this worker did, so none of them
      // is on this build — that much is certain, where which build they are on
      // is a guess. So all of them are written down, and `null` is the honest
      // answer where the guess has nothing to point at: a cache that has gone,
      // or a first build with nothing before it. Dropping those let `cacheFirst`
      // fall through and hand the page this build's payload, which is the one
      // answer worse than none (`payloadFor`). A page loaded after this runs is
      // not here, is on this build, and is served normally.
      for (const client of open) {
        const cache = before.builds[client.id] ?? newest;
        builds[client.id] = cache && cache !== CACHE_NAME && keys.includes(cache) ? cache : null;
      }
      const rec = { builds };
      legacy = Promise.resolve(rec);
      const store = await caches.open(LEGACY);
      await store.put("/legacy", new Response(JSON.stringify(rec)));
      const keep = new Set([CACHE_NAME, LEGACY, ...Object.values(builds).filter(Boolean)]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
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
   * Offline — or on a payload this worker refused (`payloadFor`) — Next's router
   * gives up and hands the *payload* URL to the browser as a navigation. Served
   * literally that is a screenful of `1:"$Sreact.fragment"`, which is what
   * saving an expense offline used to show. A document request for a payload is
   * always a mistake: send it to the route.
   *
   * A redirect rather than the route's shell served in its place, which is what
   * this did: the address the app then runs at is the address it was asked for,
   * and `/g.txt` is not a route. Every screen's back arrow is a path
   * (lib/nav.ts), `reloadCostsNothing` is a list of them (lib/update.ts), and
   * both read the one the app is standing on.
   *
   * This worker only ever sees a page it controls, and it claims no first
   * visit — so the Worker holds the same rule for the phones with no worker
   * yet (`apps/api/src/payload.ts`). Change one and change the other.
   */
  if (request.mode === "navigate" && isPayload(url)) {
    // The query is not decoration: `?id=` is which group the screen is of, so
    // it carries across rather than landing on a bare route that can only say
    // the link has no password. `_rsc` is the router's own and goes.
    event.respondWith(Response.redirect(routeWithQuery(url), 302));
    return;
  }

  // Everything an installed app needs is precached under a revision that
  // changes with the build, so it is all cache-first: a launch and every tap
  // after it paint without waiting on the network, online or off. A new deploy
  // arrives when the new worker installs — the browser revalidates sw.js on
  // navigation, and lib/update.ts asks again on every resume — not by making
  // every screen pay a round trip on the chance there is one.
  if (isPayload(url)) {
    event.respondWith(payloadFor(url, request, event.clientId));
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
