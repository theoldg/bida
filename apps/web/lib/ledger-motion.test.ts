import { afterEach, describe, expect, it } from "vitest";
import {
  awaitRoll, clearDeleted, clearSaved, letRoll, markDeleted, markSaved, peekDeleted, peekSaved, presence, runs,
  type LedgerItem, type Shown,
} from "./ledger-motion";

const day = (d: string): LedgerItem<string> => ({ key: `day:${d}`, kind: "day", label: d });
const row = (id: string): LedgerItem<string> => ({ key: id, kind: "row", row: id });
const keys = (xs: Shown<string>[]) => xs.map((x) => (x.leaving ? `-${x.key}` : x.key));

describe("presence", () => {
  it("is the next list when nothing went", () => {
    const next = [day("1"), row("a"), row("b")];
    expect(keys(presence([day("1"), row("a")], next))).toEqual(["day:1", "a", "b"]);
  });

  it("keeps a row that went where it stood", () => {
    const prev = [day("1"), row("a"), row("b"), row("c")];
    expect(keys(presence(prev, [day("1"), row("a"), row("c")]))).toEqual(["day:1", "a", "-b", "c"]);
  });

  it("keeps a day that emptied, date line and row together", () => {
    const prev = [day("2"), row("a"), day("1"), row("b"), day("0"), row("c")];
    expect(keys(presence(prev, [day("2"), row("a"), day("0"), row("c")])))
      .toEqual(["day:2", "a", "-day:1", "-b", "day:0", "c"]);
  });

  it("keeps what went from the head of the list at the head", () => {
    expect(keys(presence([day("2"), row("a"), day("1"), row("b")], [day("1"), row("b")])))
      .toEqual(["-day:2", "-a", "day:1", "b"]);
  });

  it("puts a leaving row above one that arrived after its date line", () => {
    const prev = [day("1"), row("a"), row("b")];
    expect(keys(presence(prev, [day("1"), row("new"), row("b")]))).toEqual(["day:1", "-a", "new", "b"]);
  });

  it("carries rows still leaving, and lets one that came back stay", () => {
    const once = presence([day("1"), row("a"), row("b"), row("c")], [day("1"), row("c")]);
    expect(keys(once)).toEqual(["day:1", "-a", "-b", "c"]);
    expect(keys(presence(once, [day("1"), row("b"), row("c")]))).toEqual(["day:1", "-a", "b", "c"]);
  });
});

describe("runs", () => {
  it("cuts neighbours that pass into runs", () => {
    expect(runs(["a", "b", "c", "d", "e"], (k) => k !== "c")).toEqual([["a", "b"], ["d", "e"]]);
    expect(runs(["a", "b"], () => false)).toEqual([]);
  });
});

describe("the saved row", () => {
  afterEach(clearSaved);

  it("is handed to the same group's ledger until cleared", () => {
    markSaved("g", "e1", 1000);
    expect(peekSaved("other", 1000)).toBeNull();
    expect(peekSaved("g", 2000)).toBe("e1");
    expect(peekSaved("g", 3000)).toBe("e1");
    clearSaved();
    expect(peekSaved("g", 3000)).toBeNull();
  });

  it("holds the summary's roll until the ledger lets it go, once", () => {
    let went = 0;
    awaitRoll("g", () => went++);
    const off = awaitRoll("g", () => went++);
    off();
    letRoll("other");
    expect(went).toBe(0);
    letRoll("g");
    expect(went).toBe(1);
  });

  it("lets a card that starts listening late roll at once, until the next save", () => {
    letRoll("g");
    let went = 0;
    awaitRoll("g", () => went++);
    expect(went).toBe(1);
    letRoll("g");
    markSaved("g", "e2");
    awaitRoll("g", () => went++);
    expect(went).toBe(1);
  });

  it("expires, so a ledger opened much later flashes nothing", () => {
    markSaved("g", "e1", 1000);
    expect(peekSaved("g", 1000 + 11_000)).toBeNull();
  });
});

describe("the deleted row", () => {
  afterEach(clearDeleted);

  it("is handed to the same group's ledger until cleared, and expires", () => {
    markDeleted("g", "e1", 1000);
    expect(peekDeleted("other", 1000)).toBeNull();
    expect(peekDeleted("g", 2000)).toBe("e1");
    expect(peekDeleted("g", 1000 + 11_000)).toBeNull();
    clearDeleted();
    expect(peekDeleted("g", 2000)).toBeNull();
  });

  it("holds the summary's roll like a save", () => {
    letRoll("g");
    markDeleted("g", "e1");
    let went = 0;
    awaitRoll("g", () => went++);
    expect(went).toBe(0);
    letRoll("g");
    expect(went).toBe(1);
  });
});
