/**
 * How the dev Worker marks itself while the export stays byte-identical across
 * Workers (docs/hosting.md#dev-and-production): applied on the way out, only
 * where `BIDA_ENV` is `"dev"` (`[env.dev]`).
 */

/** The icons `pnpm icons` stamps with DEV, served at the ordinary URLs. */
const DEV_ICONS = new Set(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]);

/** The asset path to serve for a request path on dev: the stamped icon, or itself. */
export function devAssetPath(pathname: string): string {
  return DEV_ICONS.has(pathname) ? `/dev${pathname}` : pathname;
}

/**
 * An asset, dressed for dev: HTML gets `data-env="dev"`, which tints the top
 * bar. The service worker precaches through here, so it stays tinted offline.
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
