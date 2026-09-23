/**
 * App-shell precache — never the API. Dexie is the offline data layer; caching
 * `/api/*` here would be a second, disagreeing source of truth.
 * See docs/frontend.md#pwa.
 *
 * Both lists below are stamped in by `scripts/precache.mjs` after the export is
 * written, from the files actually on disk. **Don't edit them, and never add a
 * hand-maintained route list**: it drifts from the app.
 */
const REVISION = "__PRECACHE_REVISION__";
const ASSETS = ["__PRECACHE_ASSETS__"];
const CACHE_NAME = `bida-shell-${REVISION}`;

/**
 * Next fetches an RSC payload — `/g.txt?id=…&_rsc=…` — on every in-app tap, and
 * a static export's payload for a route is one file whose query string is only
 * ever app state. **Match on the path alone** and the whole app navigates from
 * cache; miss them and every tap is a network round trip that fails on a train.
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
 * **Never `caches.match`** — it searches *every* cache in the origin.
 * `controllerchange` fires before `activate`, so a page reloaded onto this
 * build would be answered from the previous build's cache: an old shell or
 * `/g.txt` naming chunks this build doesn't have, and a screen drawn with
 * pieces missing (the bottom nav among them) until relaunch.
 *
 * The exception is a page still open on the previous build (`previousFor`):
 * it is served from *that* build's cache, the only place its files exist.
 */
function lookup(key, cacheName = CACHE_NAME) {
  return caches.open(cacheName).then((cache) => cache.match(key, { ignoreSearch: true }));
}

/**
 * This worker activates by itself (see `install`), so pages booted on earlier
 * builds are still on screen when it takes over. Their next tap asks for that
 * build's payload and chunks, gone from this cache and the server — and a new
 * payload handed to an old router turns a group into "No group". So
 * `activate` records which build each open page runs and keeps those caches
 * until they reload (lib/update.ts).
 *
 * **Record each page's build, never just "the previous one"**: at the deploy
 * after, a page two builds back would be pointed at a build it never ran and
 * served a stranger's `/g.txt`. The cost is one kept cache per open window.
 *
 * Kept in a cache as well as memory: an idle worker can be stopped any time.
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
 * Next reads the build id out of every payload, and when it isn't its own it
 * hard-navigates to **`res.url`**. From a cache that is the key, which is the
 * path alone — so the query, and with it the group, is lost, and the screen
 * says the link is missing its password.
 *
 * So an earlier build is served its own payload, and where that cache has
 * gone, **fail rather than hand it this build's**: the router's `catch` is the
 * only give-up path that falls back to the URL *it asked for*
 * (`fetch-server-response.js`), keeping the query, and the navigate branch
 * below turns that `.txt` back into the route. A redirect can't: `fetch`
 * follows it onto another query-less key.
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
 * **All-or-nothing**, because this worker activates the moment it installs: a
 * precache with holes replaces a complete one and the app can't paint. Likely,
 * on mobile data. So: batches, one retry for stragglers, then throw — a failed
 * install leaves the running worker and its cache alone.
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
  // **Activate as soon as the whole build is cached**, never waiting for the
  // last client to close: one forgotten tab (and iOS keeps them alive) pins a
  // phone on an old build indefinitely. Open pages keep their build through
  // `previousFor` and reload once harmless (lib/update.ts).
});

/**
 * `skip-waiting` is what older builds ask for from their update offer. This
 * worker never waits, so it is a no-op — kept so a page on such a build can
 * still take a worker that is mid-install.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
  if (event.data && event.data.type === "clients" && event.ports[0]) {
    event.waitUntil(describeClients(event.source, event.ports[0]));
  }
});

/**
 * Every copy of the app open on this origin, for /diag. Another copy is the
 * prime suspect for a database that stops answering: a background tab frozen
 * mid-transaction keeps its lock (docs/frontend.md#a-live-read-can-die).
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
 * `clients.claim`: a first visit stays uncontrolled until its next launch).
 * Record which build each open page runs and keep those caches; delete the
 * rest. **A page met before keeps the build it was known by**; only a new one
 * is assumed to be on the build immediately before.
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
      // Every window open *now* booted before this worker, so none is on this
      // build. **`null` is the honest answer where the guess has nothing to point
      // at** (cache gone, or no earlier build): dropped, `cacheFirst` would hand
      // the page this build's payload, the one answer worse than none.
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

/**
 * A notification another phone wrote (docs/notifications.md): the browser has
 * already decrypted it, so `data` is the sender's JSON — `{ title, body, url,
 * tag }`, every word from its `copy.notify`. **Something is always shown**:
 * both platforms demand it, and iOS revokes a subscription that stays silent.
 * `tag` is the group id, so a group's latest replaces its last.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not ours to read; the title alone still honours the rule above.
  }
  const title = typeof data.title === "string" && data.title ? data.title : "bida";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon-192.png",
      data: { url: sameOriginPath(data.url) },
    }),
  );
});

/** Only a path of this app — a notification must not open somewhere else. */
function sameOriginPath(url) {
  if (typeof url !== "string") return "/";
  try {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin ? parsed.pathname + parsed.search : "/";
  } catch {
    return "/";
  }
}

/** A tap: the app if it is open, taken to the url; otherwise opened there. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = open.find((c) => "focus" in c);
      if (client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
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
   * Offline — or on a payload refused by `payloadFor` — Next's router hands the
   * *payload* URL to the browser as a navigation, which served literally is a
   * screenful of `1:"$Sreact.fragment"`. **Redirect a document request for a
   * payload to its route**, never serve the shell in place: back arrows
   * (lib/nav.ts) and `reloadCostsNothing` (lib/update.ts) read the address.
   *
   * The Worker holds the same rule for phones with no worker yet
   * (`apps/api/src/payload.ts`). Change one and change the other.
   */
  if (request.mode === "navigate" && isPayload(url)) {
    // The query is not decoration: `?id=` is which group the screen is of, so
    // it carries across rather than landing on a bare route that can only say
    // the link has no password. `_rsc` is the router's own and goes.
    event.respondWith(Response.redirect(routeWithQuery(url), 302));
    return;
  }

  // Everything is precached under a per-build revision, so it is all
  // cache-first: every paint skips the network. A deploy arrives when the new
  // worker installs (sw.js is revalidated on navigation, and lib/update.ts asks
  // on every resume).
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
