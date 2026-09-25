import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { foldOps } from "./fold.js";
import { ADA, EXPENSES, MARIE, OpBuilder, SAM, THEO, marrakechOps } from "./fixtures.test-helper.js";
import type { OpDraft } from "./invariants.js";
import { restoreEntryDrafts } from "./restore.js";

/** The Marrakech log, carried on by one more phone. */
function trip() {
  const b = new OpBuilder("later", 1_743_900_000_000);
  const base = marrakechOps();
  const all = () => [...base, ...b.ops];
  const apply = (drafts: OpDraft[], actor = THEO) => {
    for (const d of drafts) b.push(d.entity, d.entityId, d.kind, d.patch, actor);
  };
  return { b, all, apply };
}

describe("restoring an entry", () => {
  it("puts the entry back exactly as it was, balances included", () => {
    const { b, all, apply } = trip();
    const before = computeBalances(foldOps(all())).byMember;
    b.push("expense", "e-hammam", "delete", {}, SAM);
    expect(computeBalances(foldOps(all())).byMember).not.toEqual(before);

    const drafts = restoreEntryDrafts(foldOps(all()), "expense", "e-hammam");
    expect(drafts).toEqual([
      { entity: "expense", entityId: "e-hammam", kind: "update", patch: { deletedAt: null } },
    ]);
    apply(drafts);
    const state = foldOps(all());
    expect(state.expenses["e-hammam"]!.deletedAt).toBeNull();
    expect(computeBalances(state).byMember).toEqual(before);
  });

  it("writes nothing for an entry that is live, or that was never there", () => {
    const state = foldOps(marrakechOps());
    expect(restoreEntryDrafts(state, "expense", "e-hammam")).toEqual([]);
    expect(restoreEntryDrafts(state, "expense", "nope")).toEqual([]);
    expect(restoreEntryDrafts(state, "settlement", "e-hammam")).toEqual([]);
  });

  it("brings back a person removed since, in the same append", () => {
    const { b, all, apply } = trip();
    // Delete everything naming Ada, and removing her is allowed.
    for (const e of EXPENSES.filter((e) => e.paidBy === ADA || e.members.includes(ADA))) {
      b.push("expense", e.id, "delete", {}, MARIE);
    }
    b.push("member", ADA, "delete", {}, MARIE);

    const drafts = restoreEntryDrafts(foldOps(all()), "expense", "e-souk");
    expect(drafts).toEqual([
      { entity: "expense", entityId: "e-souk", kind: "update", patch: { deletedAt: null } },
      { entity: "member", entityId: ADA, kind: "update", patch: { deletedAt: null } },
    ]);
    apply(drafts);
    expect(foldOps(all()).members[ADA]!.deletedAt).toBeNull();
  });

  it("brings back a cleared rate the entry is written in", () => {
    const { b, all } = trip();
    b.push("rate", "MAD", "create", { rate: "0.09", source: "typed", asOf: 1, deletedAt: null });
    for (const e of EXPENSES.filter((e) => e.mad !== undefined)) b.push("expense", e.id, "delete", {});
    b.push("rate", "MAD", "delete", {});

    const drafts = restoreEntryDrafts(foldOps(all()), "expense", "e-taxi");
    expect(drafts.map((d) => `${d.entity}/${d.entityId}`)).toEqual(["expense/e-taxi", "rate/MAD"]);
  });

  it("leaves repairs the group already owed to the sync's heal", () => {
    const { b, all } = trip();
    // Ada removed while live entries name her: owed already, not this restore's.
    b.push("expense", "e-hammam", "delete", {});
    b.push("member", ADA, "delete", {}, MARIE);
    expect(restoreEntryDrafts(foldOps(all()), "expense", "e-hammam")).toEqual([
      { entity: "expense", entityId: "e-hammam", kind: "update", patch: { deletedAt: null } },
    ]);
  });

  it("merges with a delete made offline: the later word wins", () => {
    const { b, all, apply } = trip();
    b.push("expense", "e-hammam", "delete", {}, SAM);
    apply(restoreEntryDrafts(foldOps(all()), "expense", "e-hammam"));
    b.push("expense", "e-hammam", "delete", {}, ADA);
    expect(foldOps(all()).expenses["e-hammam"]!.deletedAt).toBeTruthy();
  });
});
