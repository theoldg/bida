import { describe, expect, it } from "vitest";
import { isClientKey, isTricountKey, sessionFrom } from "./tricount";

/**
 * The two input checks before the Worker calls bunq, and the handshake reply
 * parse. bunq itself is undocumented and exercised by hand; the reply shape
 * here is what published clients read.
 */

/** A real 2048-bit SPKI public key, PEM. The private half never existed here. */
const KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwxK7Y0J3Qv7xW3oS9mFq",
  "nB2kL5TzR8cXyP1vN6dH4aG0eJ9sM3bQwUfZtI7lO2pC5rXkA1nYgV8hD6uE0jSx",
  "RbT4mK9wLpQ2cZfN7yH3vJ0aI5dGgB8eUxO1tM6rS4kCnW9pF2XqYzD7lA3bE0hV",
  "uJ5gT8cRmK1oN6wP4yQ9sZfX2dI7bL0aG3eHjU5tC8rVnM6pO1kB9xW4yE7zS2qD",
  "fA0lT3bH6uJ9gN5cRmX1oK8wP2yQ4sZeF7dI3bL6aG0eHjT5tC9rVnM2pO4kB1xW",
  "8yE3zS7qDfA6lT0bH3uJ5gN9cRmX4oK1wP8yQ2sZeF3dI7bL0aG6eHjT9tC5rVnM",
  "2wIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

describe("isTricountKey", () => {
  it("takes the tail of a tricount link", () => {
    expect(isTricountKey("tltMJWkWWUUxhUlzFm")).toBe(true);
  });

  it("refuses anything that is not letters and digits", () => {
    for (const bad of [
      "", "short", "tlt MJWk", "tlt/MJWk", "../../etc", "tlt-MJWk", "a".repeat(65),
      "?public_identifier_token=x", 12, null, undefined,
    ]) {
      expect(isTricountKey(bad)).toBe(false);
    }
  });
});

describe("isClientKey", () => {
  it("takes a PEM public key", () => {
    expect(isClientKey(KEY)).toBe(true);
    expect(isClientKey(`${KEY}\n`)).toBe(true);
  });

  it("refuses anything that is not one", () => {
    for (const bad of [
      "",
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
      "-----BEGIN PRIVATE KEY-----\n" + KEY.split("\n").slice(1).join("\n"),
      // Too short to be a 2048-bit key, and the shape of somebody probing.
      "-----BEGIN PUBLIC KEY-----\nQUJD\n-----END PUBLIC KEY-----",
      // Armour around something that is not base64.
      "-----BEGIN PUBLIC KEY-----\n" + "<script>".repeat(40) + "\n-----END PUBLIC KEY-----",
      "-".repeat(3000),
      42, null, undefined, {},
    ]) {
      expect(isClientKey(bad)).toBe(false);
    }
  });

  it("refuses a key with a second thing tacked on after it", () => {
    expect(isClientKey(`${KEY}\nand something else`)).toBe(false);
  });
});

describe("sessionFrom", () => {
  const reply = (...items: unknown[]) => ({ Response: items });

  it("finds the token and the user by key, whatever order they are in", () => {
    expect(sessionFrom(reply(
      { Id: { id: 1 } },
      { Token: { id: 9, token: "sess-abc" } },
      { UserPerson: { id: 4242, display_name: "Anon" } },
    ))).toEqual({ token: "sess-abc", userId: 4242 });

    expect(sessionFrom(reply(
      { UserPerson: { id: 7 } },
      { Token: { token: "t" } },
    ))).toEqual({ token: "t", userId: 7 });
  });

  it("takes whichever flavour of user the handshake registered", () => {
    expect(sessionFrom(reply({ Token: { token: "t" } }, { UserCompany: { id: 3 } })))
      .toEqual({ token: "t", userId: 3 });
  });

  it("is null when either half is missing or the wrong type", () => {
    expect(sessionFrom(reply({ Token: { token: "t" } }))).toBeNull();
    expect(sessionFrom(reply({ UserPerson: { id: 1 } }))).toBeNull();
    expect(sessionFrom(reply({ Token: { token: 5 } }, { UserPerson: { id: 1 } }))).toBeNull();
    expect(sessionFrom(reply({ Token: { token: "t" } }, { UserPerson: { id: "1" } }))).toBeNull();
    expect(sessionFrom({ Response: "nope" })).toBeNull();
    expect(sessionFrom({ Error: [{ error_description: "no" }] })).toBeNull();
    expect(sessionFrom(null)).toBeNull();
  });
});
