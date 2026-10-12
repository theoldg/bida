// Doc: docs/hosting.md#dev-and-production
const DEV_ICONS = new Set(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]);

export function devAssetPath(pathname: string): string {
  return DEV_ICONS.has(pathname) ? `/dev${pathname}` : pathname;
}

/** The service worker precaches through here, so dev stays dressed offline. */
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
