import { describe, expect, it } from "vitest";
import { groupNameFrom, looksLikeCsv, parseCsv, tooBig } from "./csv";

/**
 * The parser is hand-rolled, so this file is what it is worth.
 *
 * Every case here is one a real file carries: a description with a comma in
 * it, a quote somebody typed, a newline inside a cell, CRLF from Windows, a
 * BOM from Excel. Getting any of them wrong mangles money quietly, which is
 * the one failure the checksum in `core/import.ts` might not catch — so they
 * are pinned here rather than trusted.
 */
describe("the four characters RFC 4180 is about", () => {
  it("reads plain cells", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps a comma inside a quoted cell", () => {
    expect(parseCsv('a,"Dinner, wine",c')).toEqual([["a", "Dinner, wine", "c"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a,"the ""good"" cheese",c'))
      .toEqual([["a", 'the "good" cheese', "c"]]);
  });

  it("keeps a newline inside a quoted cell, which is why this is a state machine", () => {
    expect(parseCsv('a,"two\nlines",c\nd,e,f'))
      .toEqual([["a", "two\nlines", "c"], ["d", "e", "f"]]);
  });

  it("keeps a CRLF inside a quoted cell as the bytes it found", () => {
    expect(parseCsv('a,"two\r\nlines",c')).toEqual([["a", "two\r\nlines", "c"]]);
  });

  it("handles a quoted cell that is empty, and one that is only quotes", () => {
    expect(parseCsv('a,"",c')).toEqual([["a", "", "c"]]);
    expect(parseCsv('a,"""",c')).toEqual([["a", '"', "c"]]);
  });

  it("treats a quote that is not at the start of a cell as a character", () => {
    // A writer that didn't escape it. Reading it as an opener swallows the
    // rest of the file into one cell.
    expect(parseCsv('a,5" nails,c\nd,e,f'))
      .toEqual([["a", '5" nails', "c"], ["d", "e", "f"]]);
  });

  it("does not run past the end of an unterminated quoted cell", () => {
    expect(parseCsv('a,"never closed')).toEqual([["a", "never closed"]]);
  });
});

describe("the line endings a file can arrive with", () => {
  it("reads LF, which is what we write", () => {
    expect(parseCsv("a\nb")).toEqual([["a"], ["b"]]);
  });

  it("reads CRLF, which is what Windows and most exporters write", () => {
    expect(parseCsv("a\r\nb")).toEqual([["a"], ["b"]]);
  });

  it("reads a lone CR", () => {
    expect(parseCsv("a\rb")).toEqual([["a"], ["b"]]);
  });

  it("does not invent a row after a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("keeps a blank line as a row, because it is structure in this format", () => {
    // The shape has three of them, `core/import.ts` skips them by value, and
    // keeping them is what makes a refusal's line number match the person's
    // spreadsheet.
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
    expect(parseCsv("a\n\n")).toEqual([["a"], [""]]);
  });

  it("keeps the trailing blank line our own writer ends on", () => {
    expect(parseCsv("Date\n\nrow\n\nfoot\n\n"))
      .toEqual([["Date"], [""], ["row"], [""], ["foot"], [""]]);
  });
});

describe("what a file carries in front of its first cell", () => {
  it("takes the byte-order mark off the file, not the header", () => {
    expect(parseCsv("﻿Date,Description")).toEqual([["Date", "Description"]]);
  });

  it("reads an empty file as no rows at all", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("a row with nothing in it but separators", () => {
  it("is that many empty cells", () => {
    expect(parseCsv("a,b,c\n,,")).toEqual([["a", "b", "c"], ["", "", ""]]);
  });

  it("keeps a trailing empty cell, which a short row does not have", () => {
    expect(parseCsv("a,b,\nc,d")).toEqual([["a", "b", ""], ["c", "d"]]);
  });
});

describe("the file a person picked", () => {
  const asFile = (name: string, type = "") => new File(["x"], name, { type });

  it("accepts a csv by extension, by type, or by neither", () => {
    expect(looksLikeCsv(asFile("export.csv"))).toBe(true);
    expect(looksLikeCsv(asFile("export", "text/csv"))).toBe(true);
    // Safari hands a CSV out of Files with no type at all, which is not a
    // reason to refuse the one file the person went and chose.
    expect(looksLikeCsv(asFile("export"))).toBe(true);
  });

  it("refuses one that is plainly something else", () => {
    expect(looksLikeCsv(asFile("receipt.jpg", "image/jpeg"))).toBe(false);
    expect(looksLikeCsv(asFile("group.pdf", "application/pdf"))).toBe(false);
  });

  it("refuses one too big to be a group's ledger", () => {
    // Nothing is at risk but this phone's own tab; the guard is so a mis-picked
    // video says so instead of freezing on it.
    expect(tooBig(1_000)).toBe(false);
    expect(tooBig(64 * 1024 * 1024)).toBe(true);
  });
});

describe("the group name, which the shape has nowhere to say", () => {
  it("reads it off our own filename", () => {
    expect(groupNameFrom("bida-marrakech-2026-09-17.csv")).toBe("marrakech");
  });

  it("reads it off Splitwise's, which is the group and the word export", () => {
    expect(groupNameFrom("Trip to Rome_export.csv")).toBe("Trip to Rome");
  });

  it("comes back empty rather than wrong when there is nothing in the name", () => {
    expect(groupNameFrom("export.csv")).toBe("");
    expect(groupNameFrom("bida-2026-09-17.csv")).toBe("");
  });
});
