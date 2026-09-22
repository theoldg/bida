/**
 * A payload URL requested as a page, and the page it should have been.
 *
 * When Next's router fails to fetch a route's RSC payload (`/g/claim.txt?…&_rsc=…`)
 * or gets one from another build, it navigates to the payload URL itself
 * (`doMpaNavigation` in `fetch-server-response.js`) — a screen of
 * `1:"$Sreact.fragment"`.
 *
 * The service worker fixes that (`apps/web/public/sw.js`) but only once it
 * controls the page, which it doesn't on a first visit — exactly the iPhone
 * invitee landing on `/g/claim`. So the rule is here too. Needs
 * `[assets] run_worker_first` for `.txt` in `wrangler.toml`.
 *
 * Nothing else in the export ends in `.txt`; if that changes, both places need
 * a carve-out.
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
