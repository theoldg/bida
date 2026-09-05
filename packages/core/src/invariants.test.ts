import { describe, expect, it } from "vitest";
import {
  INVARIANTS, detectAll, healDrafts, liveEntriesHaveLiveRates,
  liveEntriesNameLiveMembers, restoreClaimDrafts, wouldViolate, type OpDraft,
} from "./invariants.js";
import { foldOps } from "./fold.js";
import { createHlcState, formatHlc, maxHlc } from "./hlc.js";
import type { Op } from "./ops.js";
import { ADA, GROUP, MAD_RATE, MARIE, THEO, marrakechOps } from "./fixtures.test-helper.js";
import type { GroupState } from "./types.js";

/**
 * Every invariant in the registry, held to the five rules in invariants.ts.
 *
 * This is deliberately registry-driven rather than a test per healer: the
 * defect class it guards is *an invariant nobody finished*, so the test that
 * matters is the one a new entry cannot be added without satisfying. Adding to
 * `INVARIANTS` without adding a scenario below fails the first test in the file.
 */

/** Stamp repair drafts as ops that sort after everything already in the log. */
function applyDrafts(ops: readonly Op[], drafts: readonly OpDraft[]): Op[] {
  let last: string | undefined;
  for (const op of ops) last = maxHlc(last, op.hlc);
  const after = Number(last?.split("-")[0] ?? 0) + 1;
  return [
    ...ops,
    ...drafts.map((draft, i): Op => ({
      id: `heal-${i}`,
      groupId: GROUP,
      entity: draft.entity,
      entityId: draft.entityId,
      kind: draft.kind,
      patch: draft.patch,
      hlc: formatHlc(createHlcState("healer", after, i)),
      actor: THEO,
      note: draft.note ?? null,
      createdAt: after,
      seq: null,
    })),
  ];
}

function shuffled(ops: readonly Op[], seed: number): Op[] {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return [...ops].sort(() => rand() - 0.5);
}

/** Ops reaching a state that violates one invariant, per registered name. */
const SCENARIOS: Record<string, () => Op[]> = {
  // Two phones, each right: one removes Ada, the other is offline and Ada is
  // on every expense in the fixture. The merge leaves a tombstone over money.
  liveEntriesNameLiveMembers: () => [
    ...marrakechOps(),
    {
      id: "op-remove-ada", groupId: GROUP, entity: "member", entityId: ADA,
      kind: "delete", patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_700_000_000)),
      actor: MARIE, note: null, createdAt: 1_743_700_000_000, seq: null,
    },
  ],
  // The same race one entity over: the group clears its MAD rate while five
  // live entries are still written in MAD.
  liveEntriesHaveLiveRates: () => [
    ...marrakechOps(),
    {
      id: "op-set-mad", groupId: GROUP, entity: "rate", entityId: "MAD", kind: "create",
      patch: { rate: MAD_RATE, source: "typed", asOf: 1_743_600_000_000, deletedAt: null },
      hlc: formatHlc(createHlcState("phonea", 1_743_700_000_000)),
      actor: THEO, note: null, createdAt: 1_743_700_000_000, seq: null,
    },
    {
      id: "op-clear-mad", groupId: GROUP, entity: "rate", entityId: "MAD", kind: "delete",
      patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_800_000_000)),
      actor: MARIE, note: null, createdAt: 1_743_800_000_000, seq: null,
    },
  ],
};

describe("the registry", () => {
  it("has a violating scenario for every invariant it declares", () => {
    // The ratchet. An invariant with no scenario is one whose healer has never
    // been run — the exact shape of every defect in docs/invariants.md.
    expect(INVARIANTS.map((i) => i.name).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });

  it("names every invariant it declares", () => {
    for (const invariant of INVARIANTS) {
      expect(invariant.name.length).toBeGreaterThan(0);
      expect(invariant.holds.length).toBeGreaterThan(0);
    }
  });

  it("finds nothing in a state nobody has broken", () => {
    expect(detectAll(foldOps(marrakechOps()))).toEqual({});
    expect(healDrafts(foldOps(marrakechOps()))).toEqual([]);
  });
});

describe.each(INVARIANTS.map((i) => [i.name, i] as const))("%s", (name, invariant) => {
  const ops = () => SCENARIOS[name]!();
  const violated = (): GroupState => foldOps(ops());

  it("detects the state the merge reached", () => {
    expect(invariant.detect(violated()).length).toBeGreaterThan(0);
  });

  it("detects the same state however the ops arrived", () => {
    // Detection is a pure function of state, and state is a fold — so the order
    // ops landed in cannot change what gets repaired.
    const expected = invariant.detect(violated());
    for (let seed = 1; seed <= 20; seed++) {
      expect(invariant.detect(foldOps(shuffled(ops(), seed)))).toEqual(expected);
    }
  });

  it("repairs it with ordinary ops the fold already understands", () => {
    const drafts = invariant.repair(invariant.detect(violated()));
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(["create", "update", "delete", "restore"]).toContain(draft.kind);
    }
  });

  it("folds the violation away in one pass", () => {
    const healed = foldOps(applyDrafts(ops(), healDrafts(violated())));
    expect(invariant.detect(healed)).toEqual([]);
  });

  it("is idempotent — a second run, screen or device writes nothing", () => {
    const healed = foldOps(applyDrafts(ops(), healDrafts(violated())));
    expect(healDrafts(healed)).toEqual([]);
  });

  it("writes the same repair on every device", () => {
    // Two phones noticing at once must not write two different repairs.
    const expected = healDrafts(violated());
    for (let seed = 1; seed <= 20; seed++) {
      expect(healDrafts(foldOps(shuffled(ops(), seed)))).toEqual(expected);
    }
  });

  it("reaches a fixed point, so healers cannot fight", () => {
    // One healer tombstoning what another lifts is an op loop that syncs.
    let log = ops();
    for (let round = 0; round < 5; round++) {
      const drafts = healDrafts(foldOps(log));
      if (drafts.length === 0) break;
      log = applyDrafts(log, drafts);
    }
    expect(healDrafts(foldOps(log))).toEqual([]);
    expect(detectAll(foldOps(log))).toEqual({});
  });
});

describe("the courtesy refusals", () => {
  it("refuses to remove a member the group is still naming", () => {
    const state = foldOps(marrakechOps());
    const draft: OpDraft = { entity: "member", entityId: ADA, kind: "delete", patch: {} };

    expect(wouldViolate(state, draft)?.name).toBe("liveEntriesNameLiveMembers");
  });

  it("refuses to clear a rate the group is still spending in", () => {
    const state = foldOps(SCENARIOS["liveEntriesHaveLiveRates"]!().slice(0, -1));
    const draft: OpDraft = { entity: "rate", entityId: "MAD", kind: "delete", patch: {} };

    expect(wouldViolate(state, draft)?.name).toBe("liveEntriesHaveLiveRates");
  });

  it("allows what breaks nothing", () => {
    const state = foldOps(marrakechOps());

    // Nothing names them, so the removal is an ordinary departure.
    expect(wouldViolate(state, {
      entity: "member", entityId: "m-nobody", kind: "delete", patch: {},
    })).toBeUndefined();
    // An edit is never the thing a removal guard refuses.
    expect(wouldViolate(state, {
      entity: "member", entityId: ADA, kind: "update", patch: { colorSeed: 4 },
    })).toBeUndefined();
  });

  it("is a refusal, not a correctness mechanism", () => {
    // The guard reads one replica. The peer that cannot see the entry writes
    // the removal anyway, and the healer is what the merge relies on.
    const blind = foldOps(marrakechOps().filter((o) => o.entity !== "expense"));

    expect(wouldViolate(blind, {
      entity: "member", entityId: ADA, kind: "delete", patch: {},
    })).toBeUndefined();
  });
});

describe("liveEntriesHaveLiveRates", () => {
  it("leaves alone a currency the group has never priced", () => {
    // Marrakech spends in MAD with no rate row at all. There is no number to
    // restore — that is the rate dialog's job, not a healer's.
    expect(liveEntriesHaveLiveRates.detect(foldOps(marrakechOps()))).toEqual([]);
  });

  it("leaves alone a cleared rate nothing live spends in", () => {
    const ops = SCENARIOS["liveEntriesHaveLiveRates"]!()
      .filter((o) => o.entity !== "expense");

    expect(liveEntriesHaveLiveRates.detect(foldOps(ops))).toEqual([]);
  });
});

describe("liveEntriesNameLiveMembers", () => {
  it("puts back somebody stranded only by a receipt", () => {
    // Marked present, assigned nothing, owing nothing — and removed anyway.
    const ops: Op[] = [
      ...marrakechOps(),
      {
        id: "op-receipt", groupId: GROUP, entity: "expense", entityId: "e-nomad",
        kind: "update", patch: { receiptInvolved: [THEO, ADA] },
        hlc: formatHlc(createHlcState("phonea", 1_743_700_000_000)),
        actor: THEO, note: null, createdAt: 1_743_700_000_000, seq: null,
      },
      {
        id: "op-remove", groupId: GROUP, entity: "member", entityId: ADA, kind: "delete",
        patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_800_000_000)),
        actor: MARIE, note: null, createdAt: 1_743_800_000_000, seq: null,
      },
    ];

    expect(liveEntriesNameLiveMembers.detect(foldOps(ops)).map((m) => m.id)).toEqual([ADA]);
  });

  it("leaves alone an ordinary departure", () => {
    const ops: Op[] = [
      ...marrakechOps().filter((o) => o.entity !== "expense"),
      {
        id: "op-remove", groupId: GROUP, entity: "member", entityId: ADA, kind: "delete",
        patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_800_000_000)),
        actor: MARIE, note: null, createdAt: 1_743_800_000_000, seq: null,
      },
    ];

    expect(liveEntriesNameLiveMembers.detect(foldOps(ops))).toEqual([]);
  });
});

/**
 * Not a registered invariant, and the tests say why: its premise is which
 * member *this* phone is, which no `GroupState` holds. See `restoreClaimDrafts`.
 */
describe("restoreClaimDrafts", () => {
  const removed = (member: string): GroupState => foldOps([
    ...marrakechOps().filter((o) => o.entity !== "expense"),
    {
      id: "op-remove", groupId: GROUP, entity: "member", entityId: member, kind: "delete",
      patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_800_000_000)),
      actor: MARIE, note: null, createdAt: 1_743_800_000_000, seq: null,
    },
  ]);

  it("lifts the removal of the member this phone claims", () => {
    expect(restoreClaimDrafts(removed(ADA), ADA)).toEqual([
      { entity: "member", entityId: ADA, kind: "update", patch: { deletedAt: null } },
    ]);
  });

  it("leaves somebody else's removal alone", () => {
    expect(restoreClaimDrafts(removed(ADA), MARIE)).toEqual([]);
  });

  it("writes nothing for a member who is already live, or who was never here", () => {
    expect(restoreClaimDrafts(removed(ADA), THEO)).toEqual([]);
    expect(restoreClaimDrafts(removed(ADA), "nobody")).toEqual([]);
  });

  it("is idempotent — the lifted state asks for nothing", () => {
    const state = removed(ADA);
    const healed = foldOps([
      ...marrakechOps().filter((o) => o.entity !== "expense"),
      {
        id: "op-remove", groupId: GROUP, entity: "member", entityId: ADA, kind: "delete",
        patch: {}, hlc: formatHlc(createHlcState("phoneb", 1_743_800_000_000)),
        actor: MARIE, note: null, createdAt: 1_743_800_000_000, seq: null,
      },
      {
        id: "op-back", groupId: GROUP, entity: "member", entityId: ADA, kind: "update",
        patch: restoreClaimDrafts(state, ADA)[0]!.patch,
        hlc: formatHlc(createHlcState("phonea", 1_743_900_000_000)),
        actor: ADA, note: null, createdAt: 1_743_900_000_000, seq: null,
      },
    ]);
    expect(restoreClaimDrafts(healed, ADA)).toEqual([]);
  });
});
