import { describe, expect, it } from "vitest";
import { handoverFrom } from "./group-link";
import { formatSplitLink, parseSplitLink } from "./split-link";

/** A split link is one token in a fragment (ADR-0035): short, and nobody's carry. */

describe("a split link", () => {
  const link = formatSplitLink("7f2kq9x0m3v8n1zc", "https://bida.bid");

  it("is the secret alone, in the fragment", () => {
    expect(link).toBe("https://bida.bid/split#7f2kq9x0m3v8n1zc");
    expect(parseSplitLink(link)).toBe("7f2kq9x0m3v8n1zc");
    expect(parseSplitLink("#7f2kq9x0m3v8n1zc")).toBe("7f2kq9x0m3v8n1zc");
  });

  it("reads nothing out of a fragment that isn't one", () => {
    for (const bad of ["", "#", "https://bida.bid/split", "#a.b c", "#<script>"]) {
      expect(parseSplitLink(bad)).toBeNull();
    }
  });

  it("is not taken for a carry and sent to /handover", () => {
    expect(handoverFrom("/split", "#7f2kq9x0m3v8n1zc")).toBeUndefined();
  });
});
