import { describe, expect, it } from "vitest";
import { activityFeed, entityHistory } from "./history.js";
import { foldOps } from "./fold.js";
import { GROUP, MARIE, OpBuilder, SAM, THEO } from "./fixtures.test-helper.js";

/** The "Souk haul" revision timeline, as the history screen renders it. */
function soukLog() {
  const b = new OpBuilder();
  const created = b.push("expense", "e-souk", "create", {
    description: "Souk haul · lamp + rug",
    amountMinor: 120_000, currency: "MAD", rateToBase: "0.0921",
    baseAmountMinor: 11_052, paidBy: MARIE,
    split: { mode: "equal", members: ["marie", "ada", "sam", "theo"] },
    attachmentIds: [],
  }, MARIE);
  const amount = b.push("expense", "e-souk", "update", {
    amountMinor: 185_000, baseAmountMinor: 17_039,
  }, MARIE, "forgot the rug");
  const split = b.push("expense", "e-souk", "update", {
    split: { mode: "equal", members: ["marie", "ada"] },
  }, SAM, "we didn't chip in for the rug");
  const photos = b.push("expense", "e-souk", "update", {
    attachmentIds: ["a1", "a2"],
  }, "ada");
  return { ops: b.ops, created, amount, split, photos };
}

describe("entityHistory", () => {
  it("gives one revision per change, newest first", () => {
    const { ops, photos, created } = soukLog();
    const history = entityHistory(ops, "e-souk");
    expect(history).toHaveLength(4);
    expect(history[0]?.op.id).toBe(photos.id);
    expect(history[3]?.op.id).toBe(created.id);
    expect(history[3]?.isCreate).toBe(true);
  });

  it("diffs a field against what it was immediately before", () => {
    const { ops } = soukLog();
    const history = entityHistory(ops, "e-souk");
    const amountRev = history.find((r) => r.op.note === "forgot the rug");
    const change = amountRev?.changes.find((c) => c.field === "amountMinor");
    expect(change?.before).toBe(120_000);
    expect(change?.after).toBe(185_000);
  });

  it("carries the author and the human reason", () => {
    const { ops } = soukLog();
    const splitRev = entityHistory(ops, "e-souk").find((r) => r.op.actor === SAM);
    expect(splitRev?.op.note).toBe("we didn't chip in for the rug");
    expect(splitRev?.changes.map((c) => c.field)).toEqual(["split"]);
  });

  it("marks a change that a later op overwrote", () => {
    const b = new OpBuilder();
    b.push("expense", "e1", "create", { description: "first" }, THEO);
    const overwritten = b.push("expense", "e1", "update", { description: "second" }, MARIE);
    const winner = b.push("expense", "e1", "update", { description: "third" }, SAM);

    const history = entityHistory(b.ops, "e1");
    const losing = history.find((r) => r.op.id === overwritten.id);
    expect(losing?.changes[0]?.supersededByOpId).toBe(winner.id);
    const latest = history.find((r) => r.op.id === winner.id);
    expect(latest?.changes[0]?.supersededByOpId).toBeUndefined();
  });

  it("skips ops that changed nothing", () => {
    const b = new OpBuilder();
    b.push("expense", "e1", "create", { description: "same" });
    b.push("expense", "e1", "update", { description: "same" });
    expect(entityHistory(b.ops, "e1")).toHaveLength(1);
  });

  it("records a deletion", () => {
    const b = new OpBuilder();
    b.push("expense", "e1", "create", { description: "x" });
    b.push("expense", "e1", "delete", {});
    const history = entityHistory(b.ops, "e1");
    expect(history[0]?.isDelete).toBe(true);
  });
});

describe("activityFeed", () => {
  it("interleaves every entity, newest first", () => {
    const b = new OpBuilder();
    b.push("member", "m1", "create", { name: "Ada", colorSeed: 1 });
    b.push("expense", "e1", "create", { description: "one" });
    b.push("expense", "e2", "create", { description: "two" });
    const feed = activityFeed(b.ops);
    expect(feed).toHaveLength(3);
    expect(feed[0]?.entityId).toBe("e2");
    expect(feed[2]?.entityId).toBe("m1");
    expect(activityFeed(b.ops, 2)).toHaveLength(2);
  });
});

describe("ops from a group are scoped to it", () => {
  it("keeps the group id on every op", () => {
    const b = new OpBuilder();
    b.push("expense", "e1", "create", { description: "x" });
    expect(b.ops.every((o) => o.groupId === GROUP)).toBe(true);
  });
});
