import { describe, expect, it } from "vitest";
import { versionArrival } from "./app-version";

describe("when a build counts as having arrived", () => {
  it("stamps the first revision a phone ever sees", () => {
    expect(versionArrival({}, "abc123", 1000)).toEqual({ appRevision: "abc123", appUpdatedAt: 1000 });
  });

  it("stamps a revision that replaced the one before it", () => {
    const device = { appRevision: "abc123", appUpdatedAt: 1000 };
    expect(versionArrival(device, "def456", 9000)).toEqual({ appRevision: "def456", appUpdatedAt: 9000 });
  });

  it("leaves the date alone on every later launch of the same build", () => {
    // The whole point: opening the app is not updating it. This is what stops
    // the line reading "updated just now" forever.
    const device = { appRevision: "abc123", appUpdatedAt: 1000 };
    expect(versionArrival(device, "abc123", 9000)).toBeNull();
  });
});
