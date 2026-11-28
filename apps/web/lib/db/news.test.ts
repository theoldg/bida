import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./dexie";
import { beginLook, markSeen, newsCount, recordShown } from "./news";

/** The seen mark's two doors: history moving it, and the ledger opened again. */
const g = "g1";
const key = () => db().groupKeys.get(g);

beforeEach(async () => {
  await db().groupKeys.clear();
  await db().groupKeys.put({ groupId: g, secret: "s", lastSeq: 5, seenSeq: 2 });
});

describe("a look at the ledger", () => {
  it("counts what the last one showed as seen, and nothing past it", async () => {
    expect(await beginLook(g)).toBe(false);
    await recordShown(g, 4);
    expect((await key())?.seenSeq).toBe(2);
    expect(await beginLook(g)).toBe(true);
    expect((await key())?.seenSeq).toBe(4);
  });

  it("only moves the shown mark forward, and never past the cursor", async () => {
    await recordShown(g, 4);
    await recordShown(g, 3);
    expect((await key())?.shownSeq).toBe(4);
    await recordShown(g, 9);
    expect((await key())?.shownSeq).toBe(5);
  });

  it("records nothing mid-join: a join's pages are its past", async () => {
    await db().groupKeys.put({ groupId: g, secret: "s", lastSeq: 5 });
    await recordShown(g, 5);
    expect((await key())?.shownSeq).toBeUndefined();
    expect(await beginLook(g)).toBe(false);
    expect((await key())?.seenSeq).toBeUndefined();
  });

  it("never brings old edits back, whichever door moved the mark", async () => {
    await recordShown(g, 3);
    expect(await markSeen(g, 5)).toBe(true);
    expect(await beginLook(g)).toBe(false);
    expect((await key())?.seenSeq).toBe(5);
  });
});

describe("what a ledger has shown", () => {
  it("is out of the groups list's count and the tray at once, still in the dot's", async () => {
    await recordShown(g, 5);
    expect(await newsCount(g, undefined, true)).toBe(0);
    expect((await key())?.seenSeq).toBe(2);
  });
});
