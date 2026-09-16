/**
 * How the dev Worker tells you it is the dev Worker, without the web export
 * knowing: the build stays byte-identical across both Workers
 * (docs/hosting.md#dev-and-production), so the difference is put on here, on
 * the way out. Only a Worker whose `BIDA_ENV` var is `"dev"` calls this, and
 * only `[env.dev]` sets it — production never runs a line of it.
 */

/** The icons `pnpm icons` stamps with DEV, served at the ordinary URLs. */
const DEV_ICONS = new Set(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]);

/** The asset path to serve for a request path on dev: the stamped icon, or itself. */
export function devAssetPath(pathname: string): string {
  return DEV_ICONS.has(pathname) ? `/dev${pathname}` : pathname;
}

/**
 * An asset, dressed for dev. HTML gets `data-env="dev"` on its root, which is
 * all the CSS needs to tint the top bar; the service worker precaches pages
 * through here, so an installed dev app keeps the tint offline.
 */
export async function devAsset(assets: Fetcher, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = devAssetPath(url.pathname);
  const response = path === url.pathname
    ? await assets.fetch(request)
    : await assets.fetch(new Request(new URL(path, url), request));
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  return new HTMLRewriter()
    .on("html", { element: (el) => { el.setAttribute("data-env", "dev"); } })
    .transform(response);
}
