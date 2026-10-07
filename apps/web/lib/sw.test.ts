import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `public/sw.js` is a classic worker script, so it is read off disk and run
 * in a context with the Cache API stubbed; its top-level functions land on
 * that context's global. Worth it because a mis-routed navigation is
 * invisible until a phone shows the wrong screen. `pnpm verify offline` drives the
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
    Promise<{ redirectedTo?: string; body?: string; failed?: boolean; url?: string }>;
  reuseFromEarlierBuilds: (cache: unknown, urls: string[]) => Promise<string[]>;
  pullAhead: (groupId: string) => Promise<void>;
  caches: { open: (name: string) => Promise<unknown> };
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; text?: () => Promise<string> }>;
  /** Every listener the worker added, to fire one by hand. */
  listeners: Record<string, (event: unknown) => void>;
}

/** Every cache in the fake origin, as `{ [cacheName]: { [key]: body } }`. */
type Caches = Record<string, Record<string, string>>;

function load(stored: Caches): Sandbox {
  const listeners: Record<string, (event: unknown) => void> = {};
  const context: Record<string, unknown> = {
    listeners,
    self: {
      addEventListener(type: string, listener: (event: unknown) => void) { listeners[type] = listener; },
      location: { origin: "https://bida.bid" },
      clients: { matchAll: async () => [] },
    },
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
    Response: Object.assign(
      // Built only to be put in a cache, which keeps the body.
      function Response(this: { body: string }, body: string) { this.body = body; },
      { redirect: (to: string) => ({ redirectedTo: to }), error: () => ({ failed: true }) },
    ),
    JSON,
    encodeURIComponent,
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
  /**
   * Which build a page runs is `activate`'s guess, and a page loading as it
   * runs, or a half-installed build's cache, makes it wrong. Then Next
   * hard-navigates to the response's URL, so that must be the one asked for.
   */
  it("is answered under the URL it asked for, not the cache key", async () => {
    const { payloadFor } = load({ ...caches, ...legacy({ tab: "bida-shell-old" }) });
    const res = await payloadFor(payload("/g/entry.txt?id=abc&_rsc=1"), {}, "tab");
    expect(res.body).toBe("old build");
    expect(res.url).toBeUndefined();
  });

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
    expect(res.url).toBeUndefined();
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

describe("installing a build over an earlier one", () => {
  async function install(stored: Caches, urls: string[]) {
    const sw = load(stored);
    const left = await sw.reuseFromEarlierBuilds(await sw.caches.open(CACHE_NAME), urls);
    return { left, cached: stored[CACHE_NAME] };
  }

  it("copies a hashed file an earlier build holds, and fetches only the rest", async () => {
    const { left, cached } = await install(
      { "bida-shell-old": { "/_next/static/chunks/a1.js": "a" } },
      ["/_next/static/chunks/a1.js", "/_next/static/chunks/b2.js"],
    );
    expect(cached).toEqual({ "/_next/static/chunks/a1.js": "a" });
    expect(left).toEqual(["/_next/static/chunks/b2.js"]);
  });

  it("never reuses a route or a payload: they change under the same name", async () => {
    const { left } = await install(
      { "bida-shell-old": { "/g": "old page", "/g.txt": "old payload" } },
      ["/g", "/g.txt"],
    );
    expect(left).toEqual(["/g", "/g.txt"]);
  });

  it("reads only shell caches, never the legacy record", async () => {
    const { left } = await install(
      { "bida-legacy": { "/_next/static/x.js": "not a file" } },
      ["/_next/static/x.js"],
    );
    expect(left).toEqual(["/_next/static/x.js"]);
  });
});

describe("pulling ahead when a notification lands", () => {
  const cursor = { "/pull/g%201/cursor": JSON.stringify({ token: "tok", since: 7 }) };

  it("asks from the page's cursor with its bearer, and keeps the answer as sent", async () => {
    const stored: Caches = { "bida-pull": { ...cursor } };
    const sw = load(stored);
    const asked: { url: string; init: RequestInit }[] = [];
    sw.fetch = async (url, init) => {
      asked.push({ url, init });
      return { ok: true, text: async () => "sealed answer" };
    };

    await sw.pullAhead("g 1");

    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe("/api/groups/g%201/ops");
    expect((asked[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(asked[0]!.init.body as string)).toEqual({ ops: [], since: 7 });
    expect(stored["bida-pull"]!["/pull/g%201/ops"]).toBe("sealed answer");
  });

  it("does nothing for a group the page left no cursor for", async () => {
    const sw = load({});
    let asked = false;
    sw.fetch = async () => { asked = true; return { ok: true }; };
    await sw.pullAhead("g 1");
    expect(asked).toBe(false);
  });

  it("keeps no refusal: the page's own pull hears it", async () => {
    const stored: Caches = { "bida-pull": { ...cursor } };
    const sw = load(stored);
    sw.fetch = async () => ({ ok: false });
    await sw.pullAhead("g 1");
    expect(Object.keys(stored["bida-pull"]!)).toEqual(["/pull/g%201/cursor"]);
  });

  it("survives a new build taking over, which deletes every other cache", async () => {
    const stored: Caches = { "bida-pull": { ...cursor }, "bida-shell-old": {} };
    const sw = load(stored);
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.activate!({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(stored["bida-pull"]).toEqual(cursor);
    expect(stored["bida-shell-old"]).toBeUndefined();
  });
});
