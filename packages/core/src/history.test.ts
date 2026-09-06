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
  // Spelling a default out on a create put a null -> null row in the entity's
  // own history: nine "changes" that changed nothing, on every expense. The
  // create writes only what it carries now, so the revision names only that.
  it("names only the fields a create actually carried", () => {
    const b = new OpBuilder();
    b.push("expense", "e-lean", "create", {
      description: "Dinner", amountMinor: 8450, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 8450, paidBy: THEO,
      split: { mode: "equal", members: [THEO] },
    }, THEO);
    const [rev] = entityHistory(b.ops, "e-lean");
    expect(rev?.isCreate).toBe(true);
    expect(rev?.changes.map((c) => c.field).sort()).toEqual([
      "amountMinor", "baseAmountMinor", "currency", "description", "paidBy",
      "rateToBase", "split",
    ]);
  });

  // A create leaves an unset field off the op entirely, so an edit that sends
  // an explicit `null` for it is not a change: reading absent and null as
  // different put "changed the category" in the log over edits that never
  // touched one, on the first edit of every expense.
  it("does not count an absent field written back as null", () => {
    const b = new OpBuilder();
    b.push("expense", "e-cat", "create", {
      description: "Gelato", amountMinor: 1250, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1250, paidBy: THEO,
      split: { mode: "equal", members: [THEO] },
    }, THEO);
    b.push("expense", "e-cat", "update", { categoryId: null }, THEO);
    expect(entityHistory(b.ops, "e-cat")).toHaveLength(1);
  });

  it("still counts a real value arriving where there was none", () => {
    const b = new OpBuilder();
    b.push("expense", "e-cat2", "create", {
      description: "Gelato", amountMinor: 1250, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1250, paidBy: THEO,
      split: { mode: "equal", members: [THEO] },
    }, THEO);
    b.push("expense", "e-cat2", "update", { categoryId: "c-food" }, THEO);
    const [latest] = entityHistory(b.ops, "e-cat2");
    expect(latest?.changes).toEqual([
      { field: "categoryId", before: null, after: "c-food" },
    ]);
  });

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

  // A revision names the fields that moved; the sentence over it regularly
  // needs one that didn't — the currency a contribution is in, whether this
  // entry is an income, who the other payer was.
  it("carries the whole entity either side of the revision", () => {
    const { ops } = soukLog();
    const amountRev = entityHistory(ops, "e-souk").find((r) => r.op.note === "forgot the rug");
    expect(amountRev?.before["amountMinor"]).toBe(120_000);
    expect(amountRev?.after["amountMinor"]).toBe(185_000);
    // The op moved the amount alone, and both folds still hold the rest of it.
    expect(amountRev?.after["paidBy"]).toBe(MARIE);
    expect(amountRev?.before["currency"]).toBe("MAD");
  });

  it("holds the tombstone on the delete revision's own fold", () => {
    const b = new OpBuilder();
    b.push("expense", "e-gone", "create", {
      description: "Taxi", amountMinor: 2000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 2000, paidBy: THEO,
      split: { mode: "equal", members: [THEO] },
    }, THEO);
    const gone = b.push("expense", "e-gone", "delete", {}, THEO);
    const [latest] = entityHistory(b.ops, "e-gone");
    expect(latest?.before["deletedAt"]).toBeUndefined();
    expect(latest?.after["deletedAt"]).toBe(gone.createdAt);
    // Still readable: what was deleted is the reason to open the history.
    expect(latest?.after["description"]).toBe("Taxi");
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

describe("a whole-entity write", () => {
  /**
   * The amendment that keeps history readable once an entry's content is
   * written whole: a revision is the diff of two folds, not a reading of the
   * op's keys. Without it every edit would say "changed everything".
   */
  it("reads as the one field that actually moved", () => {
    const b = new OpBuilder();
    const whole = {
      description: "Souk haul", occurredAt: 1, amountMinor: 185_000, currency: "MAD",
      rateToBase: "0.0921", baseAmountMinor: 17_039, paidBy: MARIE,
      split: { mode: "equal", members: [MARIE, SAM] }, categoryId: null,
    };
    b.push("expense", "e-souk", "create", whole, MARIE);
    // Every field again, one of them different — an ordinary Save.
    b.push("expense", "e-souk", "update", { ...whole, description: "Lamp + rug" }, MARIE);

    const [latest] = entityHistory(b.ops, "e-souk");
    expect(latest?.changes.map((c) => c.field)).toEqual(["description"]);
    expect(latest?.changes[0]).toMatchObject({ before: "Souk haul", after: "Lamp + rug" });
  });

  it("writes no revision at all when the whole entity came back unchanged", () => {
    const b = new OpBuilder();
    const whole = { description: "Hammam", amountMinor: 70_000, currency: "MAD" };
    b.push("expense", "e-hammam", "create", whole, SAM);
    b.push("expense", "e-hammam", "update", { ...whole }, SAM);

    expect(entityHistory(b.ops, "e-hammam")).toHaveLength(1);
  });

  it("does not report a createdAt the fold silently ignored", () => {
    // Write-once: a later op carrying one changes nothing, so it must not read
    // as a change either.
    const b = new OpBuilder();
    b.push("expense", "e-taxi", "create", { description: "Taxi", createdAt: 100 }, THEO);
    b.push("expense", "e-taxi", "update", { description: "Grand taxi", createdAt: 999 }, THEO);

    const [latest] = entityHistory(b.ops, "e-taxi");
    expect(latest?.changes.map((c) => c.field)).toEqual(["description"]);
  });
});
