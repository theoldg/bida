// Doc: docs/pwa.md
/**
 * A payload URL requested as a page, redirected to the page: `sw.js`'s rule,
 * here too for the first visit no service worker controls yet. Nothing else in
 * the export ends in `.txt`; if that changes, both places need a carve-out.
 */

/** Is this request the browser asking for a *document*, not the router asking for data? */
function wantsPage(request: Request): boolean {
  // Sent by browsers since Safari 16.4, and as `empty` on the router's fetch.
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return dest === "document";
  // Older WebKit (many target iPhones): navigations ask for `text/html`; Next's
  // payload fetch sends no `Accept`.
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

/**
 * The route to redirect a mis-navigated payload request to, or `null`. `?id=`
 * carries across (it names the group); `_rsc` is dropped. The fragment survives
 * a redirect on its own, keeping a `/join#<id>.<secret>` secret intact.
 */
export function pageForPayload(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (!url.pathname.endsWith(".txt")) return null;
  if (!wantsPage(request)) return null;

  // `/index.txt` is the payload for `/`, as `/g.txt` is for `/g`.
  const path = url.pathname.slice(0, -".txt".length);
  const route = path === "/index" ? "/" : path || "/";
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const query = params.toString();
  return route + (query ? `?${query}` : "");
}
