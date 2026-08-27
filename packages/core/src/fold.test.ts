import { describe, expect, it } from "vitest";
import { foldEntityAt, foldForward, foldOps, sortOps } from "./fold.js";
import { validateOp, type Op } from "./ops.js";
import { marrakechOps, GROUP, THEO } from "./fixtures.test-helper.js";
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

describe("foldEntityAt", () => {
  it("reconstructs an entity as it was at a point in the log", () => {
    const ops = [
      op({ entityId: "e1", kind: "create", hlc: at(1), patch: { description: "v1", amountMinor: 100 } }),
      op({ entityId: "e1", kind: "update", hlc: at(2), patch: { amountMinor: 200 } }),
      op({ entityId: "e1", kind: "update", hlc: at(3), patch: { amountMinor: 300 } }),
    ];
    expect(foldEntityAt(ops, "e1", at(2))?.["amountMinor"]).toBe(200);
    expect(foldEntityAt(ops, "e1", at(1))?.["amountMinor"]).toBe(100);
    expect(foldEntityAt(ops, "e1", at(0))).toBeUndefined();
  });
});
