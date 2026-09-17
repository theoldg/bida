import { describe, expect, it } from "vitest";
import { embeddedApp, looksEmbedded } from "./embedded";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const DROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)";

const ios = (ua: string) => looksEmbedded({ ua, ios: true, standalone: false });
const droid = (ua: string) => looksEmbedded({ ua, ios: false, standalone: false });

/**
 * The half that matters. A webview let through costs one person one confusing
 * join; a real browser refused costs them the app entirely, so these are the
 * cases to break the detector on first.
 */
describe("browsers it must never refuse", () => {
  it("lets iOS Safari through", () => {
    expect(ios(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1`)).toBe(false);
  });

  it("lets the WebKit browsers that copy Safari's agent through", () => {
    // Brave and DuckDuckGo ship a user agent that is Safari's but for the token
    // they add — without reading that token first, both look like a webview.
    expect(ios(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1 Brave/1.67`)).toBe(false);
    expect(ios(`${IOS} Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/604.1`)).toBe(false);
    expect(ios(`${IOS} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`)).toBe(false);
    expect(ios(`${IOS} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`)).toBe(false);
    expect(ios(`${IOS} EdgiOS/126.0 Version/17.0 Mobile/15E148 Safari/604.1`)).toBe(false);
    expect(ios(`${IOS} OPT/5.2.0 Mobile/15E148 Safari/604.1`)).toBe(false);
  });

  it("lets the Android browsers through", () => {
    expect(droid(`${DROID} Chrome/126.0.0.0 Mobile Safari/537.36`)).toBe(false);
    expect(droid(`${DROID} SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36`)).toBe(false);
    expect(droid(`${DROID} Brave/126 Chrome/126.0.0.0 Mobile Safari/537.36`)).toBe(false);
    expect(droid("Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0")).toBe(false);
  });

  it("lets a Chrome Custom Tab through — it is Chrome, storage and menus and all", () => {
    expect(droid(`${DROID} Chrome/126.0.0.0 Mobile Safari/537.36`)).toBe(false);
  });

  /**
   * The one that would be self-inflicted: an iOS home-screen web app drops the
   * `Safari/` token exactly as a webview does, so the app would refuse to run
   * in the place the whole install flow exists to get people to.
   */
  it("lets the home-screen app through, which has no Safari token either", () => {
    expect(looksEmbedded({ ua: `${IOS} Mobile/15E148`, ios: true, standalone: true })).toBe(false);
    expect(looksEmbedded({ ua: `${DROID} Chrome/126.0.0.0 Mobile Safari/537.36; wv)`, ios: false, standalone: true }))
      .toBe(false);
  });

  it("leaves a desktop alone", () => {
    expect(looksEmbedded({
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ios: false,
      standalone: false,
    })).toBe(false);
  });
});

describe("webviews it must refuse", () => {
  it("knows the iOS ones by their missing Safari token", () => {
    expect(ios(`${IOS} Mobile/15E148 Instagram 339.0.3.12.106`)).toBe(true);
    expect(ios(`${IOS} Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,3;FBMD/iPhone]`)).toBe(true);
    expect(ios(`${IOS} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/441.0]`)).toBe(true);
    // Nameless, and refused all the same — the structural signal is the floor.
    expect(ios(`${IOS} Mobile/15E148`)).toBe(true);
  });

  it("knows the Android ones by the wv token", () => {
    expect(looksEmbedded({
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram",
      ios: false,
      standalone: false,
    })).toBe(true);
  });

  it("refuses an app that puts the Safari token back, on its own token", () => {
    expect(ios(`${IOS} Mobile/15E148 GSA/348.0 Safari/604.1`)).toBe(true);
  });
});

describe("naming the app, for the screen that asks them to leave", () => {
  it("names the ones that say who they are", () => {
    expect(embeddedApp(`${IOS} Mobile/15E148 Instagram 339.0`)).toBe("Instagram");
    expect(embeddedApp(`${IOS} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/441.0]`)).toBe("Messenger");
    expect(embeddedApp(`${IOS} Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,3]`)).toBe("Facebook");
  });

  it("names nothing for a bare webview, or for a real browser", () => {
    expect(embeddedApp(`${IOS} Mobile/15E148`)).toBeUndefined();
    expect(embeddedApp(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1`)).toBeUndefined();
  });
});
