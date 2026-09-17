/**
 * A payload URL asked for as a page, and the page it should have been.
 *
 * Next's router fetches a route's RSC payload — `/g/claim.txt?id=…&_rsc=…` —
 * on every in-app tap, and when that fetch fails, or answers for a build the
 * page isn't running, it hands the *payload* URL to the browser as a plain
 * navigation (`fetch-server-response.js`: `doMpaNavigation`, and the `catch`
 * that falls back to the rewritten `.txt` URL). Served literally, that is a
 * screenful of `1:"$Sreact.fragment"` where a screen should be.
 *
 * The service worker already turns those back into the route
 * (`apps/web/public/sw.js`) — but only for a page it controls, and it does not
 * claim on a first visit. That gap is the whole iPhone join flow: the invitee
 * who has just tapped a link is on their first load of the origin, has no
 * controlling worker yet, and `/g/claim` is where `useClaimGate` sends them.
 * So the rule stands here as well, where every phone passes whichever worker
 * it does or doesn't have. Production has to route `.txt` through the Worker
 * for this to run at all — `[assets] run_worker_first` in `wrangler.toml`.
 *
 * Nothing else in the export ends in `.txt`. If that ever stops being true,
 * this wants a carve-out and so does the service worker.
 */

/** Is this request the browser asking for a *document*, not the router asking for data? */
function wantsPage(request: Request): boolean {
  // Set by every browser since Safari 16.4, and set on the router's own fetch
  // too (as `empty`), so where it exists it is the whole answer.
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return dest === "document";
  // Older WebKit — a good deal of the iPhones this is for. A navigation asks
  // for `text/html`; Next sets no `Accept` on the payload fetch, so it gets
  // `*/*`.
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

/**
 * The route to send a mis-navigated payload request to, or `null` to serve the
 * request as it stands.
 *
 * The query is not decoration: `?id=` is which group the screen is of, so it
 * carries across rather than landing on a bare route that can only say "No
 * group". `_rsc` is the router's own cache-buster and goes. The fragment needs
 * no help — a browser re-applies it across a redirect, which is what keeps a
 * `/join#<id>.<secret>` link's secret alive through one of these.
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
