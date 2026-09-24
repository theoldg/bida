import { describe, expect, it } from "vitest";
import { pageForPayload } from "./payload";

const NAV = { "Sec-Fetch-Dest": "document" };
/** What Next's router sends: no `Accept`, and `empty` where the header exists. */
const RSC = { "Sec-Fetch-Dest": "empty", RSC: "1" };

const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(`https://bida.bid${url}`, { headers });

describe("pageForPayload", () => {
  it("sends a payload navigated to as a page back to its route", () => {
    expect(pageForPayload(get("/g/claim.txt", NAV))).toBe("/g/claim");
    expect(pageForPayload(get("/g/entry/edit.txt", NAV))).toBe("/g/entry/edit");
  });

  it("keeps which group the screen is of, and drops the router's cache-buster", () => {
    expect(pageForPayload(get("/g/claim.txt?id=abc&_rsc=1h2x3", NAV))).toBe("/g/claim?id=abc");
    expect(pageForPayload(get("/g/entry.txt?id=abc&e=x1&_rsc=1h2x3", NAV)))
      .toBe("/g/entry?id=abc&e=x1");
    expect(pageForPayload(get("/g.txt?_rsc=1h2x3", NAV))).toBe("/g");
  });

  it("maps the root's payload back to the root", () => {
    expect(pageForPayload(get("/index.txt", NAV))).toBe("/");
  });

  it("leaves the router's own fetch alone — this is the whole app's navigation", () => {
    expect(pageForPayload(get("/g/claim.txt?id=abc&_rsc=1h2x3", RSC))).toBe(null);
    // No `Sec-Fetch-Dest` at all: older WebKit, where `Accept` is the tell.
    expect(pageForPayload(get("/g/claim.txt?id=abc&_rsc=1h2x3"))).toBe(null);
    expect(pageForPayload(get("/g/claim.txt", { Accept: "*/*" }))).toBe(null);
  });

  it("reads an old WebKit navigation off Accept", () => {
    const accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    expect(pageForPayload(get("/g/claim.txt?id=abc", { Accept: accept }))).toBe("/g/claim?id=abc");
  });

  it("leaves everything that is not a payload alone", () => {
    for (const path of ["/", "/g", "/g/claim", "/logo.svg", "/manifest.webmanifest", "/api/health"]) {
      expect(pageForPayload(get(path, NAV))).toBe(null);
    }
  });

  it("ignores anything but a GET", () => {
    const post = new Request("https://bida.bid/g/claim.txt", { method: "POST", headers: NAV });
    expect(pageForPayload(post)).toBe(null);
  });
});
