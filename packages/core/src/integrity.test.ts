import { describe, expect, it } from "vitest";
import { foldOps } from "./fold.js";
import { healDrafts, detectAll, type OpDraft } from "./invariants.js";
import { assertBalanced, computeBalances } from "./balance.js";
import { payerList } from "./payers.js";
import { splitParticipants } from "./split.js";
import { createHlcState, formatHlc, maxHlc } from "./hlc.js";
import type { Op } from "./ops.js";
import { alive, type GroupState } from "./types.js";
import { ADA, ALL, GROUP, MAD_RATE, MARIE, THEO, marrakechOps } from "./fixtures.test-helper.js";

/**
 * The properties that hold whatever the log says — checked over merges nobody
 * wrote a healer for.
 *
 * Every other test in this file's neighbourhood is registry-driven: it proves
 * the invariants we *declared* have working repairs. This one is the opposite
 * and is the only layer with a chance against the invariant nobody thought of.
 * It folds hostile permutations and asserts the properties the app depends on
 * everywhere, so a future feature that introduces a cross-entity precondition
 * and forgets to declare it fails here rather than in somebody's ledger.
 *
 * ## Existence is not liveness
 *
 * Two different properties, and conflating them writes a healer that destroys
 * history:
 *
 * - **Existence** — the referenced row is in the state. Always required. It is
 *   also always true by construction: a `delete` sets `deletedAt` and never
 *   removes a row, so nothing can dangle.
 * - **Liveness** — the referenced row is not tombstoned. Required only of
 *   references that move money: an entry's members and an entry's currency.
 *
 * An `identity` row pointing at a removed member is the case that forces the
 * distinction. It is a true historical fact — that device *did* claim to be
 * Bruno — and every op it stamped is attributed through it, so a healer that
 * repointed or dropped it would erase the attribution to satisfy a property we
 * never wanted. Identity claims are checked for existence and nothing more.
 */

type Strength = "live" | "exists";
interface Reference { from: string; to: string; kind: "member" | "rate"; strength: Strength }

/** Every id one entity holds of another, and how strong that reference has to be. */
function references(state: GroupState): Reference[] {
  const out: Reference[] = [];
  const base = state.group?.baseCurrency;

  for (const e of alive(state.expenses)) {
    const members = new Set([
      ...payerList(e),
      ...splitParticipants(e.split),
      ...(e.receiptInvolved ?? []),
      ...(e.receiptAssignments ?? []).flat(),
    ]);
    // Money names them, so the tombstone is what gives way.
    for (const id of members) out.push({ from: e.id, to: id, kind: "member", strength: "live" });
    if (base && e.currency !== base) {
      out.push({ from: e.id, to: e.currency, kind: "rate", strength: "live" });
    }
  }

  for (const s of alive(state.settlements)) {
    for (const id of [s.fromMember, s.toMember]) {
      out.push({ from: s.id, to: id, kind: "member", strength: "live" });
    }
    if (base && s.currency !== base) {
      out.push({ from: s.id, to: s.currency, kind: "rate", strength: "live" });
    }
  }

  // A claim is a historical fact, not a live pointer. See the note above.
  for (const i of Object.values(state.identities)) {
    out.push({ from: i.id, to: i.memberId, kind: "member", strength: "exists" });
  }

  return out;
}

/** References the state fails to honour, as sentences. */
function broken(state: GroupState): string[] {
  const problems: string[] = [];
  for (const ref of references(state)) {
    const row = ref.kind === "member" ? state.members[ref.to] : state.rates[ref.to];
    // A rate the group has never set is a currency it has not priced, not a
    // dangling reference — there is no row to point at and nothing to repair.
    if (!row) {
      if (ref.kind === "member") problems.push(`${ref.from} names missing member ${ref.to}`);
      continue;
    }
    if (ref.strength === "live" && row.deletedAt) {
      problems.push(`${ref.from} names removed ${ref.kind} ${ref.to}`);
    }
  }
  return problems;
}

function stamp(ops: readonly Op[], drafts: readonly OpDraft[], round: number): Op[] {
  let last: string | undefined;
  for (const op of ops) last = maxHlc(last, op.hlc);
  const at = Number(last?.split("-")[0] ?? 0) + 1;
  return [...ops, ...drafts.map((d, i): Op => ({
    id: `heal-${round}-${i}`, groupId: GROUP, entity: d.entity, entityId: d.entityId,
    kind: d.kind, patch: d.patch, hlc: formatHlc(createHlcState("healer", at, i)),
    actor: THEO, note: null, createdAt: at, seq: null,
  }))];
}

/** Heal until nothing more is written, the way the sync path runs it. */
function healed(ops: readonly Op[]): GroupState {
  let log = [...ops];
  for (let round = 0; round < 10; round++) {
    const drafts = healDrafts(foldOps(log));
    if (drafts.length === 0) break;
    log = stamp(log, drafts, round);
  }
  return foldOps(log);
}

let counter = 0;
function op(entity: Op["entity"], entityId: string, kind: Op["kind"], patch: Record<string, unknown>, at: number): Op {
  return {
    id: `hostile-${++counter}`, groupId: GROUP, entity, entityId, kind, patch,
    hlc: formatHlc(createHlcState("hostile", at, counter % 1000)),
    actor: MARIE, note: null, createdAt: at, seq: null,
  };
}

/**
 * Writes no single device would make together: every removal, every clearing,
 * every tombstone — the union of what several offline phones could each
 * legitimately write, which is exactly the state no guard can prevent.
 */
function hostileOps(): Op[] {
  const at = 1_743_900_000_000;
  return [
    op("rate", "MAD", "create", { rate: MAD_RATE, source: "typed", asOf: at, deletedAt: null }, at),
    ...ALL.map((id, i) => op("member", id, "delete", {}, at + 1000 + i)),
    op("rate", "MAD", "delete", {}, at + 5000),
    op("expense", "e-souk", "delete", {}, at + 6000),
    op("settlement", "s-1", "create", {
      fromMember: ADA, toMember: MARIE, amountMinor: 5000, currency: "MAD",
      rateToBase: MAD_RATE, baseAmountMinor: 461, occurredAt: at, createdAt: at,
    }, at + 7000),
    op("identity", "deadphone", "create", { memberId: ADA, claimedAt: at }, at + 8000),
    op("expense", "e-nomad", "update", { receiptInvolved: [THEO, ADA] }, at + 9000),
  ];
}

function subsets(ops: readonly Op[], seed: number): Op[] {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return ops.filter(() => rand() > 0.35).sort(() => rand() - 0.5);
}

describe("integrity under hostile merges", () => {
  it("the fixture starts clean", () => {
    expect(broken(foldOps(marrakechOps()))).toEqual([]);
  });

  it("healing leaves no live entry naming a removed member or currency", () => {
    // The property, not the invariant: nothing here names a healer, so an
    // undeclared cross-entity reference fails this even though no detector
    // knows about it.
    for (let seed = 1; seed <= 60; seed++) {
      const log = [...marrakechOps(), ...subsets(hostileOps(), seed)];

      expect({ seed, problems: broken(healed(log)) }).toEqual({ seed, problems: [] });
    }
  });

  it("heals to a fixed point from every one of them", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const state = healed([...marrakechOps(), ...subsets(hostileOps(), seed)]);

      expect({ seed, found: detectAll(state) }).toEqual({ seed, found: {} });
      expect({ seed, drafts: healDrafts(state) }).toEqual({ seed, drafts: [] });
    }
  });

  it("keeps balances summing to zero throughout", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const log = [...marrakechOps(), ...subsets(hostileOps(), seed)];

      // Before healing as well as after: a repair must never be what rescues
      // the arithmetic, only what rescues the references.
      expect(() => assertBalanced(computeBalances(foldOps(log)))).not.toThrow();
      expect(() => assertBalanced(computeBalances(healed(log)))).not.toThrow();
    }
  });

  it("heals identically however the ops arrived", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const log = [...marrakechOps(), ...subsets(hostileOps(), seed)];
      const expected = healed(log);
      let s = seed * 7;
      const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

      expect(healed([...log].sort(() => rand() - 0.5))).toEqual(expected);
    }
  });

  it("lets a claim point at a member the group removed", () => {
    // Existence, not liveness. Bruno's phone is gone; the claim is still the
    // reason his old ops can be attributed, and healing it would erase that.
    const at = 1_743_900_000_000;
    const log = [
      ...marrakechOps().filter((o) => o.entity !== "expense"),
      op("identity", "deadphone", "create", { memberId: ADA, claimedAt: at }, at),
      op("member", ADA, "delete", {}, at + 1000),
    ];
    const state = healed(log);

    expect(state.members[ADA]?.deletedAt).toBeTruthy();
    expect(state.identities["deadphone"]?.memberId).toBe(ADA);
    expect(broken(state)).toEqual([]);
  });
});
