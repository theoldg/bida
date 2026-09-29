import { afterEach, describe, expect, it } from "vitest";
import {
  awaitRoll, clearSaved, foldFrame, letRoll, foldTotal, markSaved, peekSaved, presence, runs, standard,
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

describe("foldFrame", () => {
  // A date line (38px) over the row it headed (68px, the carried pixel apart).
  const heights = [38, 67];

  it("gives up the row's blank space before any of the date line", () => {
    expect(foldFrame(heights, 40, false).heights).toEqual([38, 27]);
    expect(foldFrame(heights, 67, false).heights).toEqual([38, 0]);
    expect(foldFrame(heights, 80, false).heights).toEqual([25, 0]);
  });

  it("lays the carried line on the line above only for the last pixel", () => {
    const total = foldTotal(heights, true);
    expect(total).toBe(106);
    expect(foldFrame(heights, total - 1, true)).toEqual({ heights: [0, 0], lift: 0 });
    expect(foldFrame(heights, total, true)).toEqual({ heights: [0, 0], lift: 1 });
    expect(foldFrame(heights, total - 0.5, true).lift).toBeCloseTo(0.5);
  });

  it("never lifts without a line to carry", () => {
    expect(foldFrame(heights, 500, false)).toEqual({ heights: [0, 0], lift: 0 });
  });
});

describe("standard", () => {
  it("runs from 0 to 1, fast out of the gate and settling late", () => {
    expect(standard(0)).toBeCloseTo(0);
    expect(standard(1)).toBeCloseTo(1);
    expect(standard(0.5)).toBeGreaterThan(0.8);
    for (let t = 0; t < 1; t += 0.05) expect(standard(t + 0.05)).toBeGreaterThanOrEqual(standard(t));
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
