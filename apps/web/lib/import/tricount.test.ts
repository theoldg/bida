import { describe, expect, it } from "vitest";
import { tricountKey } from "./tricount";

/**
 * What a person pastes. The link comes out of a chat app, a share sheet or the
 * address bar, so it arrives with whitespace, a scheme that may be missing and
 * tracking on the end — and the one thing that must not happen is a reader
 * that finds a "key" in the host and sends that to bunq.
 */
describe("tricountKey", () => {
  it("takes the key off a share link", () => {
    for (const link of [
      "https://tricount.com/tltMJWkWWUUxhUlzFm",
      "http://tricount.com/tltMJWkWWUUxhUlzFm",
      "https://www.tricount.com/tltMJWkWWUUxhUlzFm",
      "tricount.com/tltMJWkWWUUxhUlzFm",
      "  https://tricount.com/tltMJWkWWUUxhUlzFm  ",
      "https://tricount.com/tltMJWkWWUUxhUlzFm/",
      "https://tricount.com/tltMJWkWWUUxhUlzFm?utm_source=whatsapp",
      "https://tricount.com/tltMJWkWWUUxhUlzFm#share",
    ]) {
      expect(tricountKey(link)).toBe("tltMJWkWWUUxhUlzFm");
    }
  });

  it("takes a bare key, for somebody who has one", () => {
    expect(tricountKey("tltMJWkWWUUxhUlzFm")).toBe("tltMJWkWWUUxhUlzFm");
  });

  it("is null for anything with no key in it", () => {
    for (const bad of [
      "",
      "   ",
      "https://tricount.com/",
      "https://tricount.com",
      "not a link",
      "https://tricount.com/a",
      "https://tricount.com/my-trip",
      "https://example.com/some/path/that-is-not?a=key",
    ]) {
      expect(tricountKey(bad)).toBeNull();
    }
  });

  it("never mistakes the host for the key", () => {
    // `tricount.com` on its own has no slash to take a tail from, and the
    // host of a real link is never what is returned.
    expect(tricountKey("https://tricount.com")).toBeNull();
    expect(tricountKey("https://tricount.com/abcdef")).toBe("abcdef");
  });
});
