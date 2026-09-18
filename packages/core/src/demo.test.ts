import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import {
  DEMO_GROUP_ID, DEMO_ME, DEMO_NAMES, demoOps, demoStamp, isDemo, type DemoCast,
} from "./demo.js";
import { foldOps } from "./fold.js";
import { createHlcState, hlcSend, type HlcState } from "./hlc.js";
import { parseMinor, sumMinor } from "./money.js";
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
  ids: { Luke: "m-luke", Han: "m-han", Chewie: "m-chewie", Ben: "m-ben" },
  colorSeeds: { Luke: 10, Han: 100, Chewie: 200, Ben: 300 },
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
    expect(state.group?.name).toBe("Passage to Alderaan");
    expect(state.group?.baseCurrency).toBe("CRD");
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
    expect(state.expenses["demo-passage"]?.description).toBe("Passage to Alderaan, no questions");
    // The rest of the spread: two payers, a foreign currency priced by the
    // group's own registry, an income, a transfer, and one entry that leaves
    // people out.
    expect(Object.keys(state.expenses["demo-cantina"]?.payers ?? {})).toHaveLength(2);
    expect(state.expenses["demo-docking"]?.currency).toBe("WUP");
    expect(state.rates["WUP"]?.rate).toBe("0.0625");
    expect(entries.some((e) => e.kind === "income")).toBe(true);
    expect(Object.values(state.settlements)).toHaveLength(1);
    const narrow = state.expenses["demo-dejarik"]?.split;
    expect(narrow?.mode === "equal" && narrow.members).toHaveLength(2);
  });

  it("itemises the cantina tab, and the bill adds up to it", () => {
    const dinner = foldOps(stamp()).expenses["demo-cantina"]!;
    const split = dinner.split;
    expect(split.mode).toBe("receipt");
    // The weights are the bill read per person, so they come to the total. Any
    // other sum would still *split* — weights are a ratio — while quietly
    // pricing the lines at something nobody ordered.
    expect(sumMinor(Object.values(split.mode === "receipt" ? split.weights : {})))
      .toBe(dinner.amountMinor);
    // A line per printed line, and a row of names for each: the grid the entry
    // screen reopens (ADR-0016) is only a grid while those two agree.
    expect(dinner.receiptAssignments).toHaveLength(dinner.receiptItems!.length);
    expect(sumMinor(dinner.receiptItems!.map((i) => parseMinor(i.amount, "CRD"))))
      .toBe(dinner.amountMinor);
    // Everyone at the table is on it, and nobody is on it who was not.
    for (const row of dinner.receiptAssignments!) {
      for (const id of row) expect(dinner.receiptInvolved).toContain(id);
    }
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
    expect(later.expenses["demo-passage"]?.occurredAt)
      .toBeGreaterThan(first.expenses["demo-passage"]!.occurredAt!);
  });
});

/**
 * The stamp is what makes an app update a re-seed (lib/db/commands/demo.ts).
 * It has one job in each direction: hold still while only the calendar moves,
 * and move the moment the story does.
 */
describe("demoStamp", () => {
  it("is the same string every time it is asked", () => {
    expect(demoStamp()).toBe(demoStamp());
    expect(demoStamp()).toMatch(/^[0-9a-z]+$/);
  });

  it("does not move with the clock, or the phone's timezone", () => {
    // Stamping is `demoOps` with its dates zeroed, so a demo opened tomorrow —
    // or in another timezone, which shifts every local midnight in it — is
    // still the same story and must not throw the group away.
    const tz = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = demoStamp();
      process.env.TZ = "Pacific/Kiritimati";
      expect(demoStamp()).toBe(utc);
    } finally {
      process.env.TZ = tz;
    }
  });
});
