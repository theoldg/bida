import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import {
  DEMO_GROUP_ID, DEMO_NAMES, demoOps, demoStamp, demoTimeline, isDemo, type DemoCast,
} from "./demo.js";
import { foldOps } from "./fold.js";
import { createHlcState, hlcSend, type HlcState } from "./hlc.js";
import { parseMinor, sumMinor } from "./money.js";
import type { Op } from "./ops.js";
import { applyTransfers, settleUp } from "./settle.js";
import { alive } from "./types.js";

/** What a visitor would notice: it folds to its story, the money is legal, and settle-up has work. */

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

/** What the web mints and core is handed. Fixed, so the log is deterministic. */
const CAST: DemoCast = {
  ids: { Luke: "m-luke", Han: "m-han", Chewie: "m-chewie", Ben: "m-ben" },
  colorSeeds: { Luke: 10, Han: 100, Chewie: 200, Ben: 300 },
  deviceNodeId: "node0001",
};

/** The timeline, stamped the way `openDemo` stamps it: one HLC run, a batch per step. */
function stamp(now = NOW, node = "node0001"): Op[] {
  let clock: HlcState = createHlcState(node);
  let i = 0;
  return demoTimeline(CAST, now).flatMap((step) => step.ops.map((draft) => {
    const sent = hlcSend(clock, step.at);
    clock = sent.state;
    return {
      id: `demo-op-${String(i++).padStart(3, "0")}`,
      groupId: DEMO_GROUP_ID,
      entity: draft.entity,
      entityId: draft.entityId,
      kind: draft.kind,
      patch: draft.patch,
      hlc: sent.hlc,
      actor: step.by,
      note: draft.note ?? null,
      createdAt: step.at,
      seq: null,
    };
  }));
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
    expect(Object.values(state.identities)[0]?.memberId).toBe(CAST.ids.Luke);
  });

  it("gives every screen something to say", () => {
    const state = foldOps(stamp());
    const entries = Object.values(state.expenses);
    expect(entries.filter((e) => !e.deletedAt)).toHaveLength(5);
    // One deleted and one edited, so history is not all creates.
    expect(entries.filter((e) => e.deletedAt)).toHaveLength(1);
    expect(state.expenses["demo-passage"]?.description).toBe("Passage to Alderaan, no questions");
    // Two payers, a foreign currency at its own rate, an income, a transfer, a partial split.
    expect(Object.keys(state.expenses["demo-cantina"]?.payers ?? {})).toHaveLength(2);
    expect(state.expenses["demo-docking"]?.currency).toBe("WUP");
    expect(state.expenses["demo-docking"]).toMatchObject({ rateToBase: "0.0625", rateSource: "typed" });
    expect(entries.some((e) => e.kind === "income")).toBe(true);
    expect(Object.values(state.settlements)).toHaveLength(1);
    const narrow = state.expenses["demo-dejarik"]?.split;
    expect(narrow?.mode === "equal" && narrow.members).toHaveLength(2);
  });

  it("itemises the cantina tab, and the bill adds up to it", () => {
    const dinner = foldOps(stamp()).expenses["demo-cantina"]!;
    const split = dinner.split;
    expect(split.mode).toBe("receipt");
    // Weights are a ratio, so a wrong sum would still split — at prices nobody ordered.
    expect(sumMinor(Object.values(split.mode === "receipt" ? split.weights : {})))
      .toBe(dinner.amountMinor);
    // The grid only reopens (ADR-0016) while lines and assignment rows agree.
    expect(dinner.receiptAssignments).toHaveLength(dinner.receiptItems!.length);
    expect(sumMinor(dinner.receiptItems!.map((i) => parseMinor(i.amount, "CRD"))))
      .toBe(dinner.amountMinor);
    // Everyone at the table is on it, and nobody is on it who was not.
    for (const row of dinner.receiptAssignments!) {
      for (const id of row) expect(dinner.receiptInvolved).toContain(id);
    }
  });

  it("writes the cantina bill out, one English line per printed line", () => {
    const dinner = foldOps(stamp()).expenses["demo-cantina"]!;
    const lines = dinner.receiptText!.split("\n");
    expect(lines).toHaveLength(dinner.receiptItems!.length);
    expect(lines[0]).toBe("2 Jawa juice 24.00");
    dinner.receiptItems!.forEach((item, i) => expect(lines[i]).toContain(item.amount));
    // Saved translated, as if somebody at the table had tapped the toggle.
    expect(dinner.receiptEnglish).toBe(true);
  });

  it("reads as a trip written down by everybody, in order, before today", () => {
    const steps = demoTimeline(CAST, NOW);
    // The HLC follows the steps, so history only reads in story order if the
    // moments do too — and a moment from later today would be a step ahead of
    // the phone's own clock.
    const today = new Date(NOW);
    today.setHours(0, 0, 0, 0);
    steps.forEach((step, i) => {
      expect(step.at).toBeLessThan(today.getTime());
      if (i > 0) expect(step.at).toBeGreaterThan(steps[i - 1]!.at);
    });
    // Not one phone's monologue: every member wrote something.
    expect(new Set(steps.map((s) => s.by))).toEqual(new Set(Object.values(CAST.ids)));
    // And the delete is dated with its step, not with when the demo was opened.
    const greedo = foldOps(stamp()).expenses["demo-greedo"]!;
    expect(greedo.deletedAt).toBe(steps.at(-1)!.at);
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
    // Not "all square": the whole point of showing somebody the balances screen.
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

/** Makes an app update re-seed (lib/db/commands/demo.ts): still across days, moves with the story. */
describe("demoStamp", () => {
  it("is the same string every time it is asked", () => {
    expect(demoStamp()).toBe(demoStamp());
    expect(demoStamp()).toMatch(/^[0-9a-z]+$/);
  });

  it("does not move with the clock, or the phone's timezone", () => {
    // Dates are zeroed, so another day or timezone is the same story.
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
