// Doc: docs/pwa.md
/**
 * `sw.js`'s rule, here too for a first visit no worker controls yet. Nothing else
 * in the export ends in `.txt`; if that changes, both need a carve-out.
 */

function wantsPage(request: Request): boolean {
  // Sent by browsers since Safari 16.4, and as `empty` on the router's fetch.
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return dest === "document";
  // Older WebKit (many target iPhones): navigations ask for `text/html`; Next's
  // payload fetch sends no `Accept`.
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

export function pageForPayload(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (!url.pathname.endsWith(".txt")) return null;
  if (!wantsPage(request)) return null;

  const path = url.pathname.slice(0, -".txt".length);
  const route = path === "/index" ? "/" : path || "/";
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const query = params.toString();
  return route + (query ? `?${query}` : "");
}
