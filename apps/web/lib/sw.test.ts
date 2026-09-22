import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `public/sw.js` is a classic worker script, so it is read off disk and run
 * in a context with the Cache API stubbed; its top-level functions land on
 * that context's global. Worth it because a mis-routed navigation is
 * invisible until a phone shows the wrong screen. `pnpm offline` drives the
 * real thing.
 */
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

/** The unstamped placeholder: `scripts/precache.mjs` fills it in at build time. */
const CACHE_NAME = "bida-shell-__PRECACHE_REVISION__";

interface Sandbox {
  routeOf: (url: URL) => string;
  routeWithQuery: (url: URL) => string;
  previousFor: (clientId: string) => Promise<string | null | undefined>;
  payloadFor: (url: URL, request: unknown, clientId: string) =>
    Promise<{ redirectedTo?: string; body?: string; failed?: boolean }>;
}

/** Every cache in the fake origin, as `{ [cacheName]: { [key]: body } }`. */
type Caches = Record<string, Record<string, string>>;

function load(stored: Caches): Sandbox {
  const context: Record<string, unknown> = {
    self: { addEventListener() {}, location: { origin: "https://bida.bid" }, clients: {} },
    URL,
    URLSearchParams,
    caches: {
      async open(name: string) {
        stored[name] ??= {};
        const entries = stored[name]!;
        return {
          // The real one ignores the query when asked to; every key here is
          // already a bare path, so stripping the query is the whole of it.
          async match(key: string, options?: { ignoreSearch?: boolean }) {
            const path = options?.ignoreSearch ? key.split("?")[0]! : key;
            const body = entries[path];
            if (body === undefined) return undefined;
            // `url` is the point of the fixture, not decoration: it is the cache
            // key, and Next reading it back off a cached payload is the defect.
            return { body, url: `https://bida.bid${path}`, json: async () => JSON.parse(body) };
          },
          async put(key: string, value: { body: string }) { entries[key] = value.body; },
          async add() {},
        };
      },
      async keys() { return Object.keys(stored); },
      async delete(name: string) { delete stored[name]; },
    },
    // Only where it lands matters here, and a relative URL — which is what the
    // worker redirects to, and what a browser resolves against the worker's own
    // scope — is one Node's `Response.redirect` refuses to parse.
    Response: { redirect: (to: string) => ({ redirectedTo: to }), error: () => ({ failed: true }) },
    async fetch() { return { ok: false, body: "network" }; },
  };
  createContext(context);
  runInContext(SOURCE, context);
  return context as unknown as Sandbox;
}

const payload = (path: string) => new URL(`https://bida.bid${path}`);

/** What `activate` writes down: which build each open page is running. */
const legacy = (builds: Record<string, string | null>) => ({
  "bida-legacy": { "/legacy": JSON.stringify({ builds }) },
});

describe("the route a payload URL belongs to", () => {
  const { routeOf, routeWithQuery } = load({});

  it("drops the .txt", () => {
    expect(routeOf(payload("/g.txt"))).toBe("/g");
    expect(routeOf(payload("/g/entry/edit.txt"))).toBe("/g/entry/edit");
  });

  it("maps the root's payload back to the root, which `/index` is not", () => {
    // The same rule as `pageForPayload` in apps/api/src/payload.ts, which is the
    // one phones with no worker yet pass through. Change one and change the other.
    expect(routeOf(payload("/index.txt"))).toBe("/");
  });

  it("keeps which group the screen is of, and drops the router's cache-buster", () => {
    expect(routeWithQuery(payload("/g/entry.txt?id=abc&e=xyz&_rsc=1h2x3")))
      .toBe("/g/entry?id=abc&e=xyz");
    expect(routeWithQuery(payload("/g.txt?_rsc=1h2x3"))).toBe("/g");
  });
});

describe("a payload asked for by a page that is not on this build", () => {
  let caches: Caches;

  beforeEach(() => {
    caches = {
      [CACHE_NAME]: { "/g/entry.txt": "new build" },
      "bida-shell-old": { "/g/entry.txt": "old build" },
    };
  });

  it("comes out of that page's own build, while that cache is here", async () => {
    const { payloadFor } = load({ ...caches, ...legacy({ tab: "bida-shell-old" }) });
    const res = await payloadFor(payload("/g/entry.txt?id=abc&e=xyz&_rsc=1"), {}, "tab");
    expect(res.body).toBe("old build");
  });

  /**
   * Handed this build's payload, Next sees a foreign build id and
   * hard-navigates to the response URL — the cache key, with no query — landing
   * on a bare `/g/entry` ("missing its password"). Failing sends the router to
   * its `catch`, which falls back to the URL it asked for, `?id=` and all.
   */
  it("fails, rather than answer from this build, once that cache has gone", async () => {
    const { payloadFor } = load({ ...caches, ...legacy({ tab: null }) });
    const res = await payloadFor(payload("/g/entry.txt?id=abc&e=xyz&_rsc=1"), {}, "tab");
    expect(res.failed).toBe(true);
    expect(res.body).toBeUndefined();
  });

  it("fails too when the build is here but the file is not", async () => {
    delete caches["bida-shell-old"]!["/g/entry.txt"];
    const { payloadFor } = load({ ...caches, ...legacy({ tab: "bida-shell-old" }) });
    expect((await payloadFor(payload("/g/entry.txt?id=abc&_rsc=1"), {}, "tab")).failed).toBe(true);
  });
});

describe("a payload asked for by a page on this build", () => {
  const caches = () => ({
    [CACHE_NAME]: { "/g/entry.txt": "new build" },
    ...legacy({ elsewhere: "bida-shell-old" }),
  });

  it("is served from the cache, never refused", async () => {
    const { payloadFor } = load(caches());
    const res = await payloadFor(payload("/g/entry.txt?id=abc&_rsc=1"), {}, "tab");
    expect(res.body).toBe("new build");
    expect(res.failed).toBeUndefined();
  });

  it("is the answer for a page with no client id either", async () => {
    const { payloadFor } = load(caches());
    expect((await payloadFor(payload("/g/entry.txt?id=abc"), {}, "")).body).toBe("new build");
  });
});

describe("which build a page is running", () => {
  it("tells a build that has gone apart from this one", async () => {
    const { previousFor } = load(legacy({ gone: null, old: "bida-shell-old" }));
    expect(await previousFor("gone")).toBe(null);
    expect(await previousFor("old")).toBe("bida-shell-old");
    // Never met, and so on this build: the page loaded after the worker did.
    expect(await previousFor("newcomer")).toBe(undefined);
  });
});
