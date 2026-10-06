import { describe, expect, it } from "vitest";
import { billRows, eatersRow, moves, netLine, peopleText, typical, type People } from "./history-rows";

const names: Record<string, string> = { a: "Ana", b: "Bo", c: "Cy", d: "Dee", e: "Eve", z: "Zoe" };
const people = (roster: string[]): People => ({ nameOf: (id) => names[id] ?? "someone", roster });
const figures = (o: Record<string, string>) => new Map(Object.entries(o));

describe("peopleText", () => {
  it("says everyone, or everyone but the one or two left out, and names otherwise", () => {
    const five = people(["a", "b", "c", "d", "e"]);
    expect(peopleText(["e", "d", "c", "b", "a"], five)).toBe("Everyone");
    expect(peopleText(["a", "b", "d", "e"], five)).toBe("Everyone but Cy");
    expect(peopleText(["a", "b", "e"], five)).toBe("Everyone but Cy, Dee");
    // Left-out as long as left-in: the names are the shorter truth.
    expect(peopleText(["a", "b"], five)).toBe("Ana, Bo");
  });

  // Two people are "Ana, Bo" either way; and someone outside the roster makes
  // "everyone" untrue.
  it("never says everyone of a pair, nor of a set reaching past the group", () => {
    expect(peopleText(["a", "b"], people(["a", "b"]))).toBe("Ana, Bo");
    expect(peopleText(["a", "b", "c", "z"], people(["a", "b", "c"]))).toBe("Ana, Bo, Cy, Zoe");
  });
});

describe("moves", () => {
  // Ten names rewritten twice is the thing this replaces.
  it("puts the people who moved alike on one row, joins and leaves first", () => {
    const rows = moves(
      figures({ a: "25.00", b: "25.00", c: "25.00", d: "25.00" }),
      figures({ a: "20.00", b: "20.00", d: "20.00", e: "20.00", z: "20.00" }),
      people(["a", "b", "c", "d", "e", "z"]),
    );
    expect(rows).toEqual([
      { name: "Eve, Zoe", mark: "+", now: "20.00" },
      { name: "Cy", mark: "−", was: "25.00" },
      { name: "Ana, Bo, Dee", was: "25.00", now: "20.00" },
    ]);
  });

  it("leaves out whoever didn't move, and shows comings and goings without figures", () => {
    expect(moves(figures({ a: "10.00", b: "5.00" }), figures({ a: "10.00", b: "6.00" }), people([])))
      .toEqual([{ name: "Bo", was: "5.00", now: "6.00" }]);
    expect(moves(figures({ a: "" }), figures({ b: "" }), people([])))
      .toEqual([{ name: "Bo", mark: "+" }, { name: "Ana", mark: "−" }]);
  });
});

describe("typical", () => {
  it("is the figure most people have, so an even split's stray cent is no news", () => {
    expect(typical([3334, 3333, 3333])).toBe(3333);
    expect(typical([])).toBeUndefined();
  });
});

describe("billRows", () => {
  const line = (label: string, amount: string, quantity = 1, labelEn: string | null = null) =>
    ({ label, labelEn, amount, quantity });

  it("pairs lines by what they say, so a reorder is nothing and a reprice is a move", () => {
    expect(billRows(
      [line("Soup", "3.00"), line("Salad", "4.00")],
      [line("Salad", "4.00"), line("Soup", "3.50")],
      false,
    )).toEqual([{ name: "Soup", was: "3.00", now: "3.50", item: true }]);
  });

  it("pairs two lines of one name one by one, the identical ones first", () => {
    expect(billRows(
      [line("Beer", "5.00"), line("Beer", "6.00")],
      [line("Beer", "6.00"), line("Beer", "5.00"), line("Beer", "7.00")],
      false,
    )).toEqual([{ name: "Beer", mark: "+", now: "7.00", item: true }]);
  });

  it("names a line in English where the bill is shown in English", () => {
    expect(billRows([], [line("Bunta koosa", "9.00", 2, "Blue milk")], true))
      .toEqual([{ name: "Blue milk", mark: "+", now: "2× 9.00", item: true }]);
  });
});

describe("eatersRow", () => {
  const p = people(["a", "b", "c"]);
  const said = (was: string[][], now: string[][]) => eatersRow("Salad", was, now, p)?.name;
  it("says what happened to a line in words", () => {
    expect(said([["a"]], [["b"]])).toBe("Salad: Ana → Bo");
    expect(said([["a"]], [["a", "b"]])).toBe("Salad: Bo joined Ana");
    expect(said([["a", "b", "c"]], [["a", "b"]])).toBe("Salad: Cy dropped out");
    expect(said([["a"]], [[]])).toBe("Salad: Ana → nobody");
    expect(eatersRow("Salad", [["b", "a"]], [["a", "b"]], p)).toBeNull();
  });

  it("reads a line split into portions portion by portion", () => {
    expect(eatersRow("Pizza", [["a"]], [["a"], ["b"]], p)?.name).toBe("Pizza: Ana → Ana / Bo");
  });
});

describe("netLine", () => {
  const show = (minor: number) => (minor / 100).toFixed(2);
  // The money a who-had-what change moved: who owes more, who less, alike together.
  it("signs each person's change, biggest gain first, nobody unmoved", () => {
    const was = new Map([["a", 1700], ["b", 2400], ["c", 2000], ["d", 2000], ["e", 500]]);
    const now = new Map([["a", 800], ["b", 4100], ["c", 1600], ["d", 1600], ["e", 500]]);
    expect(netLine(was, now, show, people(["a", "b", "c", "d", "e"])))
      .toBe("Bo +17.00 · Ana −9.00 · Cy, Dee −4.00");
  });
});
