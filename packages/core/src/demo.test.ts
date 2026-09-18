import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { DEMO_GROUP_ID, DEMO_ME, DEMO_NAMES, demoOps, isDemo, type DemoCast } from "./demo.js";
import { foldOps } from "./fold.js";
import { createHlcState, hlcSend, type HlcState } from "./hlc.js";
import type { Op } from "./ops.js";
import { applyTransfers, settleUp } from "./settle.js";
import { alive } from "./types.js";

/**
 * The seed is a group somebody will look around, so what is guarded here is
 * what a visitor would notice: that it folds to the story it claims, that the
 * money is legal, and that the balances give settle-up something to do.
 */

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

/** What the web mints and core is handed. Fixed, so the log is deterministic. */
const CAST: DemoCast = {
  ids: { Teo: "m-teo", Marie: "m-marie", Sam: "m-sam", Ada: "m-ada" },
  colorSeeds: { Teo: 10, Marie: 100, Sam: 200, Ada: 300 },
  deviceNodeId: "node0001",
};

/** The drafts, stamped the way `appendOps` stamps them: one HLC run, in order. */
function stamp(now = NOW, node = "node0001"): Op[] {
  let clock: HlcState = createHlcState(node);
  return demoOps(CAST, now).map((draft, i) => {
    const sent = hlcSend(clock, now);
    clock = sent.state;
    return {
      id: `demo-op-${String(i).padStart(3, "0")}`,
      groupId: DEMO_GROUP_ID,
      entity: draft.entity,
      entityId: draft.entityId,
      kind: draft.kind,
      patch: draft.patch,
      hlc: sent.hlc,
      actor: CAST.ids[DEMO_ME],
      note: draft.note ?? null,
      createdAt: now,
      seq: null,
    };
  });
}

describe("isDemo", () => {
  it("is the id and nothing else", () => {
    expect(isDemo(DEMO_GROUP_ID)).toBe(true);
    expect(isDemo("demodemodem")).toBe(false);
    expect(isDemo(undefined)).toBe(false);
  });
});

describe("demoOps", () => {
  it("folds to the trip it describes", () => {
    const state = foldOps(stamp());
    expect(state.group?.name).toBe("Marrakech");
    expect(state.group?.baseCurrency).toBe("EUR");
    expect(alive(state.members).map((m) => m.name).sort())
      .toEqual([...DEMO_NAMES].sort());
    // This phone is one of them, or the ledger's personal lens is blank.
    expect(Object.values(state.identities)[0]?.memberId).toBe(CAST.ids[DEMO_ME]);
  });

  it("gives every screen something to say", () => {
    const state = foldOps(stamp());
    const entries = Object.values(state.expenses);
    expect(entries.filter((e) => !e.deletedAt)).toHaveLength(5);
    // One deleted and one edited, so history is not all creates.
    expect(entries.filter((e) => e.deletedAt)).toHaveLength(1);
    expect(state.expenses["demo-riad"]?.description).toBe("Riad Jnane, four nights");
    // The rest of the spread: two payers, a foreign currency priced by the
    // group's own registry, an income, a transfer, and one entry that leaves
    // people out.
    expect(Object.keys(state.expenses["demo-dinner"]?.payers ?? {})).toHaveLength(2);
    expect(state.expenses["demo-cafe"]?.currency).toBe("MAD");
    expect(state.rates["MAD"]?.rate).toBe("0.0921");
    expect(entries.some((e) => e.kind === "income")).toBe(true);
    expect(Object.values(state.settlements)).toHaveLength(1);
    const narrow = state.expenses["demo-sunglasses"]?.split;
    expect(narrow?.mode === "equal" && narrow.members).toHaveLength(2);
  });

  it("is money: positive integer minor units, everywhere", () => {
    const state = foldOps(stamp());
    const amounts = [
      ...Object.values(state.expenses).flatMap((e) => [
        e.amountMinor, e.baseAmountMinor, ...Object.values(e.payers ?? {}),
      ]),
      ...Object.values(state.settlements).flatMap((s) => [s.amountMinor, s.baseAmountMinor]),
    ];
    for (const amount of amounts) {
      expect(Number.isSafeInteger(amount)).toBe(true);
      expect(amount).toBeGreaterThan(0);
    }
  });

  it("splits without leaving anything unapportioned", () => {
    const report = computeBalances(foldOps(stamp()));
    expect(report.problems).toEqual([]);
    // Every group's balances sum to zero, whatever is in it.
    expect(Object.values(report.byMember).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("leaves balances that settle-up has to work on, and clears them", () => {
    const report = computeBalances(foldOps(stamp()));
    const owing = Object.values(report.byMember).filter((n) => n !== 0);
    // Not "all square": the whole point of showing somebody the balances tab.
    expect(owing.length).toBeGreaterThanOrEqual(3);
    const transfers = settleUp(report.byMember);
    expect(transfers.length).toBeGreaterThanOrEqual(2);
    for (const left of Object.values(applyTransfers(report.byMember, transfers))) {
      expect(left).toBe(0);
    }
  });

  it("folds identically under any permutation", () => {
    const ops = stamp();
    const expected = foldOps(ops);
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 30; round++) {
      expect(foldOps([...ops].sort(() => rand() - 0.5))).toEqual(expected);
    }
  });

  it("is deterministic, which is what makes clearing and reopening a reset", () => {
    expect(demoOps(CAST, NOW)).toEqual(demoOps(CAST, NOW));
    // ...and dated from `now`, so it never reads stale.
    const later = foldOps(stamp(NOW + 30 * 86_400_000));
    const first = foldOps(stamp());
    expect(later.expenses["demo-riad"]?.occurredAt)
      .toBeGreaterThan(first.expenses["demo-riad"]!.occurredAt!);
  });
});
