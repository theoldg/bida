import { describe, expect, it } from "vitest";
import {
  entryParent, formParent, isKeylessFragment, parseJoinLink, readPastedLink, parseEntrySource, route,
} from "./group-link";

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

describe("a join link pasted from the clipboard", () => {
  const origin = "https://bida.app";

  it("takes a whole link from this app, whitespace and all", () => {
    expect(readPastedLink(" https://bida.app/join#g1.s3cr3t\n", origin))
      .toEqual({ kind: "join", link: { groupId: "g1", secret: "s3cr3t" } });
  });

  it("names the server a link from another deployment belongs to", () => {
    expect(readPastedLink("https://dev.bida.app/join#g1.s3cr3t", origin))
      .toEqual({ kind: "elsewhere", host: "dev.bida.app" });
    expect(readPastedLink("http://localhost:8787/join#g1.s3cr3t", origin))
      .toEqual({ kind: "elsewhere", host: "localhost:8787" });
  });

  it("finds nothing in what isn't a join link, from anywhere", () => {
    for (const text of [
      "g1.s3cr3t", "https://bida.app/g?id=g1", "https://bida.app/join#nodot",
      "https://dev.bida.app/about", "dinner was 42 euros", "",
    ]) expect(readPastedLink(text, origin)).toEqual({ kind: "none" });
  });
});

describe("a link that lost its password", () => {
  it("is a group id alone, with or without its hash, or with the dot left dangling", () => {
    expect(isKeylessFragment("#g1")).toBe(true);
    expect(isKeylessFragment("g1")).toBe(true);
    expect(isKeylessFragment("#abc_DEF-123.")).toBe(true);
  });

  it("is not a whole link, which joins", () => {
    expect(isKeylessFragment("#g1.s3cr3t")).toBe(false);
    expect(parseJoinLink("#g1.s3cr3t")).not.toBeNull();
  });

  it("is not nothing at all, or a fragment with characters no link has", () => {
    expect(isKeylessFragment("")).toBe(false);
    expect(isKeylessFragment("#")).toBe(false);
    expect(isKeylessFragment("#g1%20")).toBe(false);
    expect(isKeylessFragment("#g1)")).toBe(false);
    expect(isKeylessFragment("#.s3cr3t")).toBe(false);
  });

  it("never overlaps a link that parses, so the two screens cannot disagree", () => {
    for (const hash of ["#g1", "#g1.", "#g1.s", "#.s", "#", "", "#g1.s.t", "#g 1"]) {
      expect(isKeylessFragment(hash) && parseJoinLink(hash) !== null).toBe(false);
    }
  });
});
