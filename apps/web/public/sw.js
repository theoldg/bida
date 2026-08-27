/**
 * App-shell precache only — never the API. Dexie is the offline data layer;
 * caching `/api/*` responses here would be a second, disagreeing source of
 * truth. See docs/frontend.md#pwa.
 *
 * Bump CACHE_VERSION whenever this file's caching behaviour changes so old
 * clients drop their stale cache on the next activate.
 */
const CACHE_VERSION = "v1";
const CACHE_NAME = `hajsik-shell-${CACHE_VERSION}`;

// Every static route in the app (per ADR-0007, the full set is known at
// build time — no dynamic segments). Kept in sync by hand; a route missing
// here just means its first visit needs to be online, same as before this
// file existed.
const SHELL_URLS = [
  "/", "/new", "/g", "/g/expense", "/g/expense/edit", "/g/split",
  "/g/history", "/g/members", "/g/settle", "/join", "/settings",
  "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Best-effort: one missing route shouldn't fail the whole install.
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never the API — Dexie owns offline data

  // Hashed, immutable build output: cache-first, filled in lazily.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
        return res;
      })),
    );
    return;
  }

  // Pages: network-first so a phone online gets the latest ledger shell,
  // falling back to the precached copy the moment it isn't. Every screen
  // carries its state in the query string (never a path segment — ADR-0007),
  // so the cache lookup ignores it: /g?id=... falls back to the shell at /g.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, res.clone()));
          return res;
        })
        .catch(() => caches.match(url.pathname, { ignoreSearch: true })
          .then((cached) => cached ?? caches.match("/"))),
    );
  }
});
