import { describe, expect, it } from "vitest";
import { groupMeta, historyMeta, transferMeta } from "./row-meta";

describe("transferMeta", () => {
  it("says the note alone when there is one", () => {
    expect(transferMeta("Airport taxi")).toEqual(["Airport taxi"]);
    expect(transferMeta("  Airport taxi ")).toEqual(["Airport taxi"]);
  });

  it("says the label when there is no note", () => {
    expect(transferMeta(undefined)).toEqual(["Transfer"]);
    expect(transferMeta("   ")).toEqual(["Transfer"]);
    expect(transferMeta(null)).toEqual(["Transfer"]);
  });
});

describe("groupMeta", () => {
  it("drops people, then entries, and keeps the time", () => {
    expect(groupMeta({ people: 9, entries: 61, when: "2d ago" })).toEqual([
      "9 people · 61 entries · 2d ago",
      "61 entries · 2d ago",
      "2d ago",
    ]);
  });

  it("counts one the singular way", () => {
    expect(groupMeta({ people: 1, entries: 1, when: "just now" })[0])
      .toBe("1 person · 1 entry · just now");
  });
});

describe("historyMeta", () => {
  it("names the creator of an entry nobody edited, then falls back to History", () => {
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke" }))
      .toEqual(["Created by Luke", "History"]);
  });

  it("counts the edits and names the last editor, then drops the name", () => {
    expect(historyMeta({ edits: 1, creator: "Luke", lastEditor: "Han" }))
      .toEqual(["Edited once · by Han", "Edited once"]);
    expect(historyMeta({ edits: 3, creator: "Luke", lastEditor: "Han" }))
      .toEqual(["Edited 3 times · last by Han", "Edited 3 times"]);
  });

  it("says an untouched imported entry was imported, not created", () => {
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke", imported: "Tricount" }))
      .toEqual(["Imported from Tricount by Luke", "Imported from Tricount"]);
    // A group imported before it kept its source.
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke", imported: true }))
      .toEqual(["Imported by Luke", "Imported"]);
    // Once edited, the edits are the news.
    expect(historyMeta({ edits: 1, creator: "Luke", lastEditor: "Han", imported: "Tricount" }))
      .toEqual(["Edited once · by Han", "Edited once"]);
  });
});
