import { describe, expect, it } from "vitest";
import { entryParent, parseEntrySource, route } from "./group-link";

describe("where an entry goes back to", () => {
  it("is the group when the ledger opened it", () => {
    expect(route.entry("g1", "x1")).toBe("/g/entry?id=g1&e=x1");
    expect(entryParent("g1", undefined)).toBe(route.group("g1"));
  });

  it("is the screen that linked in from beside it", () => {
    expect(route.entry("g1", "x1", "history")).toBe("/g/entry?id=g1&e=x1&via=history");
    expect(entryParent("g1", "history")).toBe(route.history("g1"));
    expect(entryParent("g1", "members")).toBe(route.members("g1"));
    expect(entryParent("g1", "rates")).toBe(route.rates("g1"));
  });

  it("ignores a via nobody wrote — a hand-edited URL is still the group", () => {
    expect(parseEntrySource("payers")).toBeUndefined();
    expect(parseEntrySource(null)).toBeUndefined();
    expect(entryParent("g1", parseEntrySource("javascript:alert(1)"))).toBe(route.group("g1"));
  });

  it("carries via down onto an entry's own history, so back is exact", () => {
    expect(route.history("g1", "x1", "members")).toBe("/g/history?id=g1&e=x1&via=members");
    expect(parseEntrySource("members")).toBe("members");
  });
});
