import { describe, expect, it } from "vitest";
import { fakeD1 } from "./d1.test-helper";
import { deleteSplit, getSplit, isSplitId, putSplit } from "./splits";

/**
 * A shared split is one row written once (ADR-0035): pressing again is a
 * no-op, and only the link's own token may write over or remove it.
 */

const ID = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000_000;

describe("splits", () => {
  it("stores a split and hands it back", async () => {
    const db = fakeD1();
    expect(await putSplit(db, ID, "t1", "AQID", NOW)).toBe("ok");
    expect(await getSplit(db, ID)).toBe("AQID");
    expect(await getSplit(db, "f".repeat(32))).toBeNull();
  });

  it("keeps the first body when the same phone presses again", async () => {
    const db = fakeD1();
    await putSplit(db, ID, "t1", "first", NOW);
    expect(await putSplit(db, ID, "t1", "second", NOW + 1)).toBe("ok");
    expect(await getSplit(db, ID)).toBe("first");
  });

  it("refuses a write under another token, and leaves the row alone", async () => {
    const db = fakeD1();
    await putSplit(db, ID, "t1", "first", NOW);
    expect(await putSplit(db, ID, "t2", "forged", NOW)).toBe("wrong token");
    expect(await getSplit(db, ID)).toBe("first");
  });

  it("removes a split for its own token only", async () => {
    const db = fakeD1();
    await putSplit(db, ID, "t1", "AQID", NOW);
    expect(await deleteSplit(db, ID, "t2")).toBe("wrong token");
    expect(await getSplit(db, ID)).toBe("AQID");
    expect(await deleteSplit(db, ID, "t1")).toBe("ok");
    expect(await getSplit(db, ID)).toBeNull();
    expect(await deleteSplit(db, ID, "t1")).toBe("unknown");
  });

  it("takes only a derived id as a row's key", () => {
    expect(isSplitId(ID)).toBe(true);
    for (const bad of ["", ID.toUpperCase(), `${ID}0`, "7f2kq9x0m3v8n1zc", "../groups"]) {
      expect(isSplitId(bad)).toBe(false);
    }
  });
});
