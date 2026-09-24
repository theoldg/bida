import { describe, expect, it } from "vitest";
import { reloadCostsNothing } from "./update";

/**
 * The one list, asked by two reloads: the update's (lib/update.ts) and the iOS
 * carry's (components/install.tsx). What it must never say yes to is a screen
 * holding something only this page's memory has.
 */
describe("reloadCostsNothing", () => {
  it("is every screen there is nothing on to lose", () => {
    for (const path of ["/", "/g", "/g/balances", "/g/members", "/g/history", "/g/entry", "/about"]) {
      expect(reloadCostsNothing(path)).toBe(true);
    }
  });

  it("is not the two forms, whose draft is in memory and warns on unload", () => {
    expect(reloadCostsNothing("/g/entry/edit")).toBe(false);
    expect(reloadCostsNothing("/new")).toBe(false);
  });

  it("is not a flow, which a reload drops back a step", () => {
    for (const path of ["/join", "/g/claim", "/install", "/quick", "/quick/items", "/quick/result"]) {
      expect(reloadCostsNothing(path)).toBe(false);
    }
  });

  it("reads a trailing slash as the same screen", () => {
    expect(reloadCostsNothing("/g/")).toBe(true);
    expect(reloadCostsNothing("/")).toBe(true);
    expect(reloadCostsNothing("")).toBe(true);
    expect(reloadCostsNothing("/g/entry/edit/")).toBe(false);
  });
});
