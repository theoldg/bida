/**
 * App-shell precache — never the API: Dexie is the offline data layer, and a
 * cached `/api/*` would be a second, disagreeing truth (docs/pwa.md).
 *
 * Both lists are stamped in by `scripts/precache.mjs` from the files on disk.
 * Never hand-maintain a route list here: it drifts from the app.
 */
const REVISION = "__PRECACHE_REVISION__";
const ASSETS = ["__PRECACHE_ASSETS__"];
const CACHE_NAME = `bida-shell-${REVISION}`;
const SHELL_PREFIX = "bida-shell-";
/** `{ builds: { [clientId]: cacheName | null } }` for open pages on earlier builds. */
const LEGACY = "bida-legacy";
/** The pull ahead's stash (docs/sync.md#the-pull-ahead); names shared with lib/db/stash.ts. */
const PULLS = "bida-pull";

/**
 * Next fetches an RSC payload (`/g.txt?id=…&_rsc=…`) on every in-app tap. The
 * query is only app state, so payloads are matched on the path alone and the
 * whole app navigates from cache.
 */
function isPayload(url) {
  return url.pathname.endsWith(".txt");
}

/** `/g.txt` is `/g`; the root's is `/index.txt`. Mirrored in apps/api/src/payload.ts. */
function routeOf(url) {
  const path = url.pathname.slice(0, -".txt".length);
  return path === "/index" ? "/" : path || "/";
}

function routeWithQuery(url) {
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const query = params.toString();
  return routeOf(url) + (query ? `?${query}` : "");
}

/**
 * Never `caches.match`, which searches every cache: `controllerchange` fires
 * before `activate`, so a reloaded page would be answered from the previous
 * build's cache and drawn with pieces missing.
 */
function lookup(key, cacheName = CACHE_NAME) {
  return caches.open(cacheName).then((cache) => cache.match(key, { ignoreSearch: true }));
}

/**
 * This worker activates by itself, so pages booted on earlier builds are still
 * open, and their next tap asks for files only their build's cache holds.
 * `activate` records each open page's build (not just "the previous one") and
 * keeps those caches until the pages reload (lib/update.ts). Persisted, since
 * an idle worker can be stopped any time.
 */
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
 * The cache an earlier-build page is answered from: a name, `null` when that
 * build's cache is gone, or `undefined` for a page on this build.
 */
async function previousFor(clientId) {
  if (!clientId) return undefined;
  const { builds } = await legacyRecord();
  const cache = builds[clientId];
  if (cache === undefined || cache === CACHE_NAME) return undefined;
  return cache;
}

/**
 * A page on an earlier build gets its own payload, or an error — never this
 * build's. Next hard-navigates to a foreign payload's `res.url`, which from a
 * cache is the query-less key, losing the group. The router's `catch` falls
 * back to the URL it asked for, query intact.
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

/** Returns the URLs that failed. */
async function addAll(cache, urls) {
  const failed = [];
  for (let i = 0; i < urls.length; i += 12) {
    const batch = urls.slice(i, i + 12);
    const results = await Promise.allSettled(batch.map((url) => cache.add(url)));
    results.forEach((r, j) => r.status === "rejected" && failed.push(batch[j]));
  }
  return failed;
}

/**
 * Copies `/_next/static/` files an earlier build already holds — their names
 * carry a content hash, so same URL, same bytes. Without it every deploy
 * refetched the whole app on every phone. Returns what is left to fetch.
 */
async function reuseFromEarlierBuilds(cache, urls) {
  const earlier = await Promise.all(
    (await caches.keys())
      .filter((k) => k.startsWith(SHELL_PREFIX) && k !== CACHE_NAME)
      .map((k) => caches.open(k)),
  );
  const left = [];
  for (const url of urls) {
    let hit;
    if (url.startsWith("/_next/static/")) {
      for (const old of earlier) if ((hit = await old.match(url))) break;
    }
    if (hit) await cache.put(url, hit);
    else left.push(url);
  }
  return left;
}

/**
 * All-or-nothing, with one retry: this worker activates the moment it installs,
 * and a precache with holes would replace a complete one. A failed install
 * leaves the running worker alone.
 *
 * It never waits for the last client to close: one forgotten tab (iOS keeps
 * them alive) would pin a phone on an old build indefinitely.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const missing = await addAll(cache, await addAll(cache, await reuseFromEarlierBuilds(cache, ASSETS)));
      if (missing.length) {
        // Or the next `activate` mistakes this half-filled cache for a real build.
        await caches.delete(CACHE_NAME);
        throw new Error(`precache incomplete: ${missing.length} of ${ASSETS.length} missing`);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // Sent by older builds' update offer; kept so they can still take a worker mid-install.
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
  if (event.data && event.data.type === "clients" && event.ports[0]) {
    event.waitUntil(describeClients(event.source, event.ports[0]));
  }
});

/**
 * Every open copy of the app, for /diag: a frozen background tab holding a
 * lock is the prime suspect for a database that stops answering. Paths only,
 * since the report gets pasted into messages.
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
      lifecycle: c.lifecycleState,
    })),
  });
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const [keys, open, before] = await Promise.all([
        caches.keys(),
        self.clients.matchAll({ type: "window", includeUncontrolled: true }),
        readRecord(),
      ]);
      // `caches.keys()` is in creation order: the newest other shell is the
      // best guess for a page we have not met.
      const newest = keys.filter((k) => k.startsWith(SHELL_PREFIX) && k !== CACHE_NAME).pop() ?? null;
      const builds = {};
      // Every open window booted before this worker. `null` where the guess
      // points nowhere: `cacheFirst` would otherwise hand it this build's payload.
      for (const client of open) {
        const cache = before.builds[client.id] ?? newest;
        builds[client.id] = cache && cache !== CACHE_NAME && keys.includes(cache) ? cache : null;
      }
      const rec = { builds };
      legacy = Promise.resolve(rec);
      const store = await caches.open(LEGACY);
      await store.put("/legacy", new Response(JSON.stringify(rec)));
      const keep = new Set([CACHE_NAME, LEGACY, PULLS, ...Object.values(builds).filter(Boolean)]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    })(),
  );
});

/**
 * A notification another phone wrote, already decrypted: `{ title, body, url,
 * tag }`. Something is always shown — iOS revokes a subscription that stays
 * silent. `tag` is the group id, so a group's latest replaces its last.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Unreadable: the default title still shows something.
  }
  const title = typeof data.title === "string" && data.title ? data.title : "bida";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : undefined;
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag,
      // A replacement is news, so it buzzes again. Chrome refuses `renotify` without a tag.
      renotify: !!tag,
      // Blank: the app icon would repeat the badge, and no icon draws a grey letter.
      icon: "/notify-blank.png",
      data: { url: sameOriginPath(data.url) },
    }),
    tag ? pullAhead(tag).catch(() => undefined) : undefined,
  ]));
});

/**
 * Pull the notified group and stash the sealed answer for the app to apply
 * before it draws (`applyStash`). Never the only copy: a lost stash leaves the
 * ops to the ordinary pull.
 */
async function pullAhead(groupId) {
  const cache = await caches.open(PULLS);
  const base = `/pull/${encodeURIComponent(groupId)}`;
  const found = await cache.match(`${base}/cursor`);
  if (!found) return;
  const cursor = await found.json();
  if (typeof cursor.token !== "string" || typeof cursor.since !== "number") return;
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cursor.token}` },
    body: JSON.stringify({ ops: [], since: cursor.since }),
  });
  if (!res.ok) return;
  await cache.put(`${base}/ops`, new Response(await res.text(), {
    headers: { "Content-Type": "application/json" },
  }));
}

/** A notification must never open another site. */
function sameOriginPath(url) {
  if (typeof url !== "string") return "/";
  try {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin ? parsed.pathname + parsed.search : "/";
  } catch {
    return "/";
  }
}

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
  if (url.pathname.startsWith("/api/")) return;
  // The crop model is versioned in its path: the HTTP cache keeps its 2.5 MB across deploys.
  if (url.pathname.startsWith("/scanic/")) return;

  // Offline, Next navigates to the payload URL itself, which served as-is is a
  // screenful of RSC. Redirect to the route, query kept: `?id=` is the group.
  // Mirrored in apps/api/src/payload.ts.
  if (request.mode === "navigate" && isPayload(url)) {
    event.respondWith(Response.redirect(routeWithQuery(url), 302));
    return;
  }

  if (isPayload(url)) {
    event.respondWith(payloadFor(url, request, event.clientId));
    return;
  }

  if (request.mode === "navigate") {
    // A miss with no network: the front door beats the browser's error page.
    event.respondWith(cacheFirst(url.pathname, request).catch(() => lookup("/")));
    return;
  }

  event.respondWith(cacheFirst(request, request, event.clientId));
});
