import { describe, expect, it } from "vitest";
import { foldForward, foldOps, sortOps } from "./fold.js";
import { validateOp, type Op } from "./ops.js";
import { marrakechOps, GROUP, THEO } from "./fixtures.test-helper.js";
import { alive } from "./types.js";
import { createHlcState, formatHlc } from "./hlc.js";

function op(partial: Partial<Op> & Pick<Op, "entityId" | "kind" | "hlc">): Op {
  return validateOp({
    id: `id-${partial.hlc}`,
    groupId: GROUP,
    entity: "expense",
    patch: {},
    actor: THEO,
    createdAt: 1000,
    ...partial,
  });
}
const at = (ms: number, counter = 0) => formatHlc(createHlcState("aaa", ms, counter));

describe("foldOps", () => {
  it("builds the group from its ops", () => {
    const state = foldOps(marrakechOps());
    expect(state.group?.name).toBe("Marrakech");
    expect(state.group?.baseCurrency).toBe("EUR");
    expect(Object.keys(state.members)).toHaveLength(4);
    expect(Object.keys(state.expenses)).toHaveLength(7);
  });

  it("is order-independent — any shuffle folds identically", () => {
    const ops = marrakechOps();
    const expected = foldOps(ops);
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 30; round++) {
      const shuffled = [...ops].sort(() => rand() - 0.5);
      expect(foldOps(shuffled)).toEqual(expected);
    }
  });

  it("resolves same-field conflicts by highest HLC, not arrival order", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "first" } }),
      op({ entityId: "e1", kind: "update", hlc: at(3), patch: { description: "late" } }),
      op({ entityId: "e1", kind: "update", hlc: at(2), patch: { description: "early" } }),
    ];
    expect(foldOps(ops).expenses["e1"]?.description).toBe("late");
    expect(foldOps([...ops].reverse()).expenses["e1"]?.description).toBe("late");
  });

  it("merges concurrent edits to different fields", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "dinner", amountMinor: 100 } }),
      op({ entityId: "e1", kind: "update", hlc: at(2), patch: { amountMinor: 250 } }),
      op({ entityId: "e1", kind: "update", hlc: at(2, 1), patch: { description: "lunch" } }),
    ];
    const e = foldOps(ops).expenses["e1"];
    expect(e?.amountMinor).toBe(250);
    expect(e?.description).toBe("lunch");
  });

  it("tolerates an update arriving before its create", () => {
    const ops = [op({ entityId: "e1", kind: "update", hlc: at(2), patch: { description: "edited" } })];
    expect(foldOps(ops).expenses["e1"]?.description).toBe("edited");
    const withCreate = [
      ...ops,
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "orig", amountMinor: 5 } }),
    ];
    const e = foldOps(withCreate).expenses["e1"];
    expect(e?.description).toBe("edited");
    expect(e?.amountMinor).toBe(5);
  });

  it("tombstones rather than removing, so references still resolve", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "x" } }),
      op({ entityId: "e1", kind: "delete", hlc: at(2) }),
    ];
    const e = foldOps(ops).expenses["e1"];
    expect(e).toBeDefined();
    expect(e?.deletedAt).toBeTruthy();
  });

  it("refuses to let a patch rewrite identity", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { id: "hacked", groupId: "elsewhere", description: "x" } }),
    ];
    const e = foldOps(ops).expenses["e1"];
    expect(e?.id).toBe("e1");
    expect(e?.groupId).toBe(GROUP);
  });

  it("sorts by hlc then op id, never by createdAt", () => {
    const a = op({ entityId: "e1", kind: "update", hlc: at(5), patch: {}, createdAt: 9_000_000 });
    const b = op({ entityId: "e1", kind: "update", hlc: at(6), patch: {}, createdAt: 1 });
    expect(sortOps([b, a]).map((o) => o.hlc)).toEqual([at(5), at(6)]);
  });
});

/**
 * A create writes no field it would only be defaulting — `only()` in
 * apps/web/lib/db/commands/patch.ts drops them. That is only safe because absent and
 * spelled-out-null fold to the same entity for every reader, which is what
 * these pin.
 */
describe("a create that leaves its defaults out", () => {
  const carried = {
    description: "Dinner at the harbour",
    occurredAt: 1_743_600_000_000,
    createdAt: 1_743_600_000_000,
    amountMinor: 8450,
    currency: "EUR",
    rateToBase: "1",
    baseAmountMinor: 8450,
    paidBy: THEO,
    split: { mode: "equal", members: [THEO] },
  };
  /** What the same expense used to be written as, before `only()`. */
  const defaults = {
    categoryId: null, payers: null, attachmentIds: [], receiptItems: null,
    receiptTip: null, receiptInvolved: null, receiptAssignments: null,
    splitTab: null, deletedAt: null,
  };
  const folded = (patch: Record<string, unknown>) =>
    foldOps([op({ entityId: "e1", kind: "create", hlc: at(1), patch })])
      .expenses["e1"] as unknown as Record<string, unknown>;

  it("agrees field for field with one that spells them out", () => {
    // Absent, null and — for `attachmentIds`, whose default is a list — empty
    // are one thing to every reader of an expense. Nothing asks which it got.
    const empty = (v: unknown) => v === undefined || v === null
      || (Array.isArray(v) && v.length === 0);
    const lean = folded(carried);
    const verbose = folded({ ...carried, ...defaults });
    for (const key of [...Object.keys(carried), ...Object.keys(defaults)]) {
      if (empty(lean[key]) && empty(verbose[key])) continue;
      expect(lean[key]).toEqual(verbose[key]);
    }
  });

  it("carries none of them, which is the point", () => {
    expect(Object.keys(folded(carried)).sort())
      .toEqual(["amountMinor", "baseAmountMinor", "createdAt", "currency", "description",
        "groupId", "id", "occurredAt", "paidBy", "rateToBase", "split"]);
  });

  it("is alive, and still takes a tombstone", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: carried }),
      op({ entityId: "e1", kind: "delete", hlc: at(2) }),
    ];
    expect(alive(foldOps([ops[0]!]).expenses)).toHaveLength(1);
    expect(alive(foldOps(ops).expenses)).toHaveLength(0);
  });

  it("still takes a later update that sets one of them", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: carried }),
      op({ entityId: "e1", kind: "update", hlc: at(2), patch: { splitTab: "receipt" } }),
    ];
    expect(foldOps(ops).expenses["e1"]?.splitTab).toBe("receipt");
  });
});

describe("foldForward", () => {
  it("advances an existing state with strictly newer ops", () => {
    const base = foldOps([op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "a" } })]);
    const next = foldForward(base, [op({ entityId: "e1", kind: "update", hlc: at(2), patch: { description: "b" } })]);
    expect(next?.expenses["e1"]?.description).toBe("b");
  });

  it("refuses when an op sorts before what's already applied", () => {
    const base = foldOps([op({ entityId: "e1", kind: "create", hlc: at(5), patch: { description: "a" } })]);
    expect(foldForward(base, [op({ entityId: "e1", kind: "update", hlc: at(2), patch: { description: "b" } })])).toBeNull();
  });
});

