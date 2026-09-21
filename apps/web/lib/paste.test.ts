import { describe, expect, it } from "vitest";
import { readClipboardText, type Pasteboard } from "./paste";

const LINK = "https://bida.app/join#g1.s1";

/** A pasteboard that answers each read in turn, and counts them. */
function answering(...answers: (string | Error)[]): Pasteboard & { reads: number } {
  const io = {
    reads: 0,
    read: async () => {
      const answer = answers[io.reads++] ?? "";
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return io;
}

describe("reading the clipboard for a link", () => {
  it("takes the answer it is given", async () => {
    const io = answering(LINK);
    expect(await readClipboardText(io)).toBe(LINK);
    expect(io.reads).toBe(1);
  });

  it("never asks twice, since a second prompt is a second tap", async () => {
    const io = answering("", LINK);
    expect(await readClipboardText(io)).toBe("");
    expect(io.reads).toBe(1);
  });

  it("reads whitespace as empty", async () => {
    const io = answering(" \n");
    expect(await readClipboardText(io)).toBe("");
  });

  it("says nothing at all when the person dismisses the bubble", async () => {
    const io = answering(new Error("NotAllowedError"));
    expect(await readClipboardText(io)).toBeUndefined();
    expect(io.reads).toBe(1);
  });
});
