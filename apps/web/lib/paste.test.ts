import { describe, expect, it } from "vitest";
import { readClipboardText, type Pasteboard } from "./paste";

const LINK = "https://bida.app/join#g1.s1";

/** A pasteboard that answers each read in turn, and records what it waited. */
function answering(...answers: (string | Error)[]): Pasteboard & { reads: number; waited: number[] } {
  const io = {
    reads: 0,
    waited: [] as number[],
    read: async () => {
      const answer = answers[io.reads++] ?? "";
      if (answer instanceof Error) throw answer;
      return answer;
    },
    sleep: async (ms: number) => { io.waited.push(ms); },
  };
  return io;
}

describe("reading the clipboard for a link", () => {
  it("takes the first answer when there is one", async () => {
    const io = answering(LINK);
    expect(await readClipboardText(io)).toBe(LINK);
    expect(io.reads).toBe(1);
  });

  it("asks again when the read that drew the Paste bubble comes back empty", async () => {
    const io = answering("", LINK);
    expect(await readClipboardText(io)).toBe(LINK);
    expect(io.reads).toBe(2);
    // The post-grant snapshot is there by the next turn of the loop.
    expect(io.waited).toEqual([]);
  });

  it("waits once more for a pasteboard still arriving after a resume", async () => {
    const io = answering("", "", LINK);
    expect(await readClipboardText(io)).toBe(LINK);
    expect(io.waited).toEqual([250]);
  });

  it("gives up on an empty clipboard, and does not ask forever", async () => {
    const io = answering("", "", "");
    expect(await readClipboardText(io)).toBe("");
    expect(io.reads).toBe(3);
  });

  it("reads whitespace as empty", async () => {
    const io = answering(" \n", " \n", " \n");
    expect(await readClipboardText(io)).toBe("");
  });

  it("says nothing at all when the person dismisses the bubble", async () => {
    const io = answering(new Error("NotAllowedError"));
    expect(await readClipboardText(io)).toBeUndefined();
    expect(io.reads).toBe(1);
  });

  it("treats a refused re-read as empty, since nobody said no to the first", async () => {
    const io = answering("", new Error("NotAllowedError"));
    expect(await readClipboardText(io)).toBe("");
  });
});
