import { describe, expect, it } from "vitest";
import { asksBeforeJoin, iosBrowser, looksIos, offerFrom } from "./install";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";

describe("what the browser lets us offer", () => {
  it("offers nothing once it's already on the home screen", () => {
    // Including iOS, which keeps firing no event either way.
    expect(offerFrom({ standalone: true, hasPrompt: false, ios: true })).toBe("installed");
    expect(offerFrom({ standalone: true, hasPrompt: true, ios: false })).toBe("installed");
  });

  it("prefers the captured prompt to instructions", () => {
    expect(offerFrom({ standalone: false, hasPrompt: true, ios: false })).toBe("ready");
  });

  it("falls back to instructions only on iOS", () => {
    expect(offerFrom({ standalone: false, hasPrompt: false, ios: true })).toBe("manual");
    expect(offerFrom({ standalone: false, hasPrompt: false, ios: false })).toBe("none");
  });
});

describe("spotting iOS", () => {
  it("knows an iPhone", () => {
    expect(looksIos(IPHONE, "iPhone", 5)).toBe(true);
  });

  it("knows an iPad pretending to be a Mac", () => {
    expect(looksIos(IPAD, "MacIntel", 5)).toBe(true);
  });

  it("leaves a real Mac and an Android phone alone", () => {
    expect(looksIos(IPAD, "MacIntel", 0)).toBe(false);
    expect(looksIos(ANDROID, "Linux armv8l", 5)).toBe(false);
  });
});

describe("naming the iOS browser", () => {
  const tail = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  it("tells Safari from Chrome", () => {
    expect(iosBrowser(`${tail} Version/17.5 Mobile/15E148 Safari/604.1`)).toBe("Safari");
    expect(iosBrowser(`${tail} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`)).toBe("Chrome");
  });

  it("names nothing it can't be sure of", () => {
    expect(iosBrowser(`${tail} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`)).toBeUndefined();
    expect(iosBrowser(`${tail} EdgiOS/126.0 Version/17.0 Mobile/15E148 Safari/604.1`)).toBeUndefined();
    // An in-app web view (Instagram, Gmail) carries no Safari token.
    expect(iosBrowser(`${tail} Mobile/15E148 Instagram 339.0.3.12.106`)).toBeUndefined();
  });
});

describe("asking before an iOS tab joins", () => {
  it("asks only a tab that forgets", () => {
    expect(asksBeforeJoin({ offer: "manual", claimed: false, continued: false })).toBe(true);
    for (const offer of ["installed", "ready", "none"] as const) {
      expect(asksBeforeJoin({ offer, claimed: false, continued: false })).toBe(false);
    }
  });

  it("asks once: not a group already claimed or already kept here", () => {
    expect(asksBeforeJoin({ offer: "manual", claimed: true, continued: false })).toBe(false);
    expect(asksBeforeJoin({ offer: "manual", claimed: false, continued: true })).toBe(false);
  });
});
