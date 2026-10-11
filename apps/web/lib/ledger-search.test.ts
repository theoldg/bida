import { describe, expect, it } from "vitest";
import { keepQuery, openingQuery, shownAt } from "./ledger-search";

/** A 50px bar, as `--search-h` has it. */
const BAR = 50;

describe("shownAt", () => {
  it("brings a pixel of the bar for each pixel scrolled over the last bar's height", () => {
    const base = 108;
    expect(shownAt(0, base, BAR)).toBe(0);
    expect(shownAt(base - BAR, base, BAR)).toBe(0);
    expect(shownAt(base - 25, base, BAR)).toBe(0.5);
    expect(shownAt(base, base, BAR)).toBe(1);
    expect(shownAt(base + 400, base, BAR)).toBe(1);
  });

  it("is wholly away at the top of a list whose head is shorter than the bar", () => {
    // The whole of the travel brings it, or a sliver would show at rest.
    expect(shownAt(0, 46, BAR)).toBe(0);
    expect(shownAt(23, 46, BAR)).toBe(0.5);
    expect(shownAt(46, 46, BAR)).toBe(1);
  });

  it("is whole where there is no head to scroll away: over results", () => {
    expect(shownAt(0, 0, BAR)).toBe(1);
  });

  it("never leaves 0 to 1, whatever a rubber-banding scroller reports", () => {
    expect(shownAt(-80, 108, BAR)).toBe(0);
    expect(shownAt(1e6, 108, BAR)).toBe(1);
  });
});

describe("openingQuery", () => {
  it("gives the kept query back on a way back, and only to its group", () => {
    keepQuery("a", "pizza");
    expect(openingQuery("a", true)).toBe("pizza");
    expect(openingQuery("b", true)).toBe("");
  });

  it("forgets it on an arrival that is not a way back", () => {
    // search → result → back → up to the list → tap in → entry → back
    keepQuery("a", "pizza");
    expect(openingQuery("a", false)).toBe("");
    expect(openingQuery("a", true)).toBe("");
  });

  it("forgets a cleared query", () => {
    keepQuery("a", "pizza");
    keepQuery("a", "");
    expect(openingQuery("a", true)).toBe("");
  });
});
