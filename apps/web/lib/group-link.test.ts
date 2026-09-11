import { describe, expect, it } from "vitest";
import { entryParent, formParent, parseEntrySource, route } from "./group-link";

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
    expect(entryParent("g1", "balances")).toBe(route.group("g1", "balances"));
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

describe("where saving the entry form goes", () => {
  it("is the entry that was being edited, carrying its own via", () => {
    expect(route.editEntry("g1", "x1", "history")).toBe("/g/entry/edit?id=g1&e=x1&via=history");
    expect(formParent("g1", "x1", "history")).toBe(route.entry("g1", "x1", "history"));
    expect(formParent("g1", "x1", undefined)).toBe(route.entry("g1", "x1"));
  });

  it("is the balances tab when settle up opened the form", () => {
    expect(route.transferBetween("g1", "a", "b", 500, "Reimbursement"))
      .toBe("/g/entry/edit?id=g1&kind=transfer&via=balances"
        + "&from=a&to=b&amount=500&title=Reimbursement");
    expect(formParent("g1", undefined, "balances")).toBe(route.group("g1", "balances"));
  });

  it("is the ledger for a new entry the ledger's + asked for", () => {
    expect(route.addEntry("g1")).toBe("/g/entry/edit?id=g1");
    expect(formParent("g1", undefined, undefined)).toBe(route.group("g1"));
  });

  it("holds via across the who-had-what detour", () => {
    expect(route.items("g1", "history")).toBe("/g/entry/items?id=g1&via=history");
    expect(route.items("g1")).toBe("/g/entry/items?id=g1");
  });
});
