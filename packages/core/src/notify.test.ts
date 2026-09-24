import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { foldOps } from "./fold.js";
import { convertMinor } from "./money.js";
import { notices, wantsNotice, type Notice } from "./notify.js";
import type { Op } from "./ops.js";
import { ADA, GROUP, MARIE, OpBuilder, SAM, THEO } from "./fixtures.test-helper.js";
import type { SplitSpec } from "./types.js";

/**
 * Who hears about a command (docs/notifications.md#what-is-said). Each test
 * folds a group, runs one command's ops on top, and asks `notices` what the
 * author's phone would send. Money arithmetic, so every rounding edge the
 * ledger has is checked against `computeBalances`.
 */

function group(base = "EUR", members = [ADA, MARIE, SAM, THEO]) {
  const b = new OpBuilder();
  b.push("group", GROUP, "create", { name: "Trip", baseCurrency: base, createdAt: 1 });
  for (const [i, id] of members.entries()) b.push("member", id, "create", { name: id, colorSeed: i });
  return b;
}

interface ExpenseSeed {
  amount: number;
  currency?: string;
  rate?: string;
  paidBy?: string;
  payers?: Record<string, number> | null;
  split?: SplitSpec;
  kind?: "income";
  description?: string;
}

function expensePatch(seed: ExpenseSeed, base = "EUR") {
  const currency = seed.currency ?? base;
  const rateToBase = seed.rate ?? "1";
  return {
    ...(seed.kind ? { kind: seed.kind } : {}),
    description: seed.description ?? "Dinner",
    occurredAt: 1000,
    createdAt: 1000,
    amountMinor: seed.amount,
    currency,
    rateToBase,
    baseAmountMinor: currency === base ? seed.amount : convertMinor(seed.amount, currency, base, rateToBase),
    paidBy: seed.paidBy ?? THEO,
    payers: seed.payers ?? null,
    split: seed.split ?? { mode: "equal", members: [ADA, MARIE, SAM, THEO] },
  };
}

/** Run `command` on top of `b`'s ops and return what `me` would send. */
/** Run `command` on top of `b`'s ops and return what `me` would send to people in it. */
function run(b: OpBuilder, command: (b: OpBuilder) => void, me = THEO): Notice[] {
  return runAll(b, command, me).filter((n) => n.involved);
}

/** The same, including the members an "all" phone would hear about too. */
function runAll(b: OpBuilder, command: (b: OpBuilder) => void, me = THEO): Notice[] {
  const before = foldOps(b.ops);
  const start = b.ops.length;
  command(b);
  const mine: Op[] = b.ops.slice(start);
  return notices(before, foldOps(b.ops), mine, me);
}

const to = (list: Notice[]) => list.map((n) => n.to);

describe("notices: adding", () => {
  it("tells everyone in the split but the author, with their share", () => {
    const b = group();
    const list = run(b, (b) => b.push("expense", "e1", "create", expensePatch({ amount: 4200 })));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    for (const n of list) {
      expect(n).toMatchObject({ by: THEO, change: "added", moved: [], baseCurrency: "EUR" });
      expect(n.before).toBeUndefined();
      expect(n.after).toMatchObject({ kind: "expense", description: "Dinner", amountMinor: 4200, share: 1050, paid: null });
    }
  });

  it("tells a payer who isn't in the split, with no share and what they put in", () => {
    const b = group();
    const list = run(b, (b) => b.push("expense", "e1", "create", expensePatch({
      amount: 3000, paidBy: SAM, payers: { [SAM]: 2000, [THEO]: 1000 },
      split: { mode: "equal", members: [ADA, THEO] },
    })));
    expect(to(list)).toEqual([ADA, SAM]);
    const sam = list.find((n) => n.to === SAM)!;
    expect(sam.after).toMatchObject({ share: null, paid: 2000 });
    expect(list.find((n) => n.to === ADA)!.after).toMatchObject({ share: 1500, paid: null });
  });

  it("an income reads as one, the share being what each person receives", () => {
    const b = group();
    const list = run(b, (b) => b.push("expense", "e1", "create", expensePatch({
      amount: 900, kind: "income", paidBy: MARIE, split: { mode: "equal", members: [ADA, MARIE, THEO] },
    })));
    expect(to(list)).toEqual([ADA, MARIE]);
    expect(list.find((n) => n.to === MARIE)!.after).toMatchObject({ kind: "income", share: 300, paid: 900 });
  });

  it("the author is never told, even as the only other person's payer", () => {
    const b = group();
    expect(run(b, (b) => b.push("expense", "e1", "create", expensePatch({
      amount: 500, split: { mode: "equal", members: [THEO] },
    })))).toEqual([]);
  });

  it("nobody is told about a group with no base currency yet", () => {
    const b = new OpBuilder();
    expect(run(b, (b) => b.push("expense", "e1", "create", expensePatch({ amount: 100 })))).toEqual([]);
  });
});

describe("notices: shares agree with the ledger to the last minor unit", () => {
  // The cent goes where `computeBalances` puts it, or a notification and the
  // ledger disagree about what somebody owes.
  const cases: [string, number, SplitSpec][] = [
    ["EUR", 1000, { mode: "equal", members: [ADA, MARIE, SAM] }],
    ["JPY", 1000, { mode: "equal", members: [ADA, MARIE, SAM] }],
    ["KWD", 10_001, { mode: "equal", members: [ADA, MARIE, SAM] }],
    ["EUR", 1001, { mode: "shares", weights: { [ADA]: 2, [MARIE]: 1, [SAM]: 1 } }],
    ["JPY", 999, { mode: "percent", bps: { [ADA]: 3333, [MARIE]: 3333, [SAM]: 3334 } }],
    ["KWD", 1234, { mode: "exact", amounts: { [ADA]: 1000, [MARIE]: 200, [SAM]: 34 } }],
    ["EUR", 2003, { mode: "receipt", weights: { [ADA]: 7, [MARIE]: 5, [SAM]: 3 } }],
  ];
  for (const [base, amount, split] of cases) {
    it(`${split.mode} in ${base}, ${amount} minor`, () => {
      const b = group(base);
      const list = run(b, (b) => b.push("expense", "e-cent", "create", expensePatch({ amount, split }, base)));
      const owed = computeBalances(foldOps(b.ops)).owedMinor;
      expect(to(list)).toEqual([ADA, MARIE, SAM]);
      for (const n of list) {
        expect(n.baseCurrency).toBe(base);
        expect(n.after).toMatchObject({ share: owed[n.to] });
      }
      const sum = list.reduce((s, n) => s + (n.after?.kind !== "transfer" ? n.after!.share ?? 0 : 0), 0);
      expect(sum).toBe(amount);
    });
  }

  it("a foreign entry is valued at the registry's rate today, as the ledger is", () => {
    const b = group();
    b.push("rate", "USD", "create", { rate: "0.5", source: "typed", asOf: 1 });
    const list = run(b, (b) => b.push("expense", "e1", "create", expensePatch({
      amount: 1000, currency: "USD", rate: "0.9", split: { mode: "equal", members: [ADA, THEO] },
    })));
    expect(list[0]!.after).toMatchObject({ amountMinor: 1000, currency: "USD", baseAmountMinor: 500, share: 250 });
  });
});

describe("notices: editing", () => {
  const seeded = () => {
    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 4000 }));
    return b;
  };
  const edit = (b: OpBuilder, { occurredAt, ...over }: ExpenseSeed & { occurredAt?: number }) =>
    b.push("expense", "e1", "update", { ...expensePatch(over), ...(occurredAt ? { occurredAt } : {}) });

  it("an amount change tells everyone in it, with the share before and after", () => {
    const list = run(seeded(), (b) => edit(b, { amount: 4200 }));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    expect(list[0]).toMatchObject({
      change: "edited", moved: ["amount"],
      before: { amountMinor: 4000, share: 1000 }, after: { amountMinor: 4200, share: 1050 },
    });
  });

  it("title, date and category alone tell nobody", () => {
    expect(run(seeded(), (b) => edit(b, { amount: 4000, description: "Supper", occurredAt: 5000 }))).toEqual([]);
    expect(run(seeded(), (b) => b.push("expense", "e1", "update", { categoryId: "food", note: "x" }))).toEqual([]);
  });

  it("a split rewritten in another mode that means the same thing tells nobody", () => {
    const weights = { [ADA]: 1, [MARIE]: 1, [SAM]: 1, [THEO]: 1 };
    expect(run(seeded(), (b) => edit(b, { amount: 4000, split: { mode: "shares", weights } }))).toEqual([]);
  });

  it("someone dropped from the split hears it with no share after; someone added, none before", () => {
    const list = run(seeded(), (b) => edit(b, {
      amount: 4000, split: { mode: "equal", members: [MARIE, SAM, THEO] },
    }));
    expect(list.every((n) => n.moved.join() === "split")).toBe(true);
    expect(list.find((n) => n.to === ADA)).toMatchObject({ before: { share: 1000 }, after: { share: null } });
    const marie = list.find((n) => n.to === MARIE)!;
    expect(marie.before).toMatchObject({ share: 1000 });
    expect([1333, 1334]).toContain(marie.after?.kind === "expense" ? marie.after.share : undefined);

    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 3000, split: { mode: "equal", members: [MARIE, THEO] } }));
    const added = run(b, (b) => edit(b, { amount: 3000, split: { mode: "equal", members: [ADA, MARIE, THEO] } }));
    expect(to(added)).toEqual([ADA, MARIE]);
    expect(added.find((n) => n.to === ADA)).toMatchObject({ before: { share: null }, after: { share: 1000 } });
  });

  it("a new payer is news, and names who moved", () => {
    const list = run(seeded(), (b) => edit(b, { amount: 4000, paidBy: SAM }));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    expect(list[0]!.moved).toEqual(["payers"]);
    expect(list.find((n) => n.to === SAM)).toMatchObject({ before: { paid: null }, after: { paid: 4000 } });
  });

  it("co-payers written two ways that mean one payer aren't a move", () => {
    expect(run(seeded(), (b) => edit(b, { amount: 4000, payers: { [THEO]: 4000 } }))).toEqual([]);
  });

  it("turning an expense into an income is news", () => {
    const list = run(seeded(), (b) => edit(b, { amount: 4000, kind: "income" }));
    expect(list[0]).toMatchObject({ moved: ["kind"], before: { kind: "expense" }, after: { kind: "income" } });
  });

  it("several moves at once are all named", () => {
    const list = run(seeded(), (b) => edit(b, { amount: 5000, currency: "USD", rate: "1", paidBy: SAM }));
    expect(list[0]!.moved).toEqual(["amount", "currency", "payers"]);
  });

  it("a rate moved by the same command doesn't make every entry in that currency news", () => {
    const b = group();
    b.push("rate", "USD", "create", { rate: "0.5", source: "typed", asOf: 1 });
    b.push("expense", "e-usd", "create", expensePatch({ amount: 1000, currency: "USD", rate: "0.5" }));
    const list = run(b, (b) => {
      b.push("rate", "USD", "update", { rate: "0.8", asOf: 2 });
      b.push("expense", "e2", "create", expensePatch({ amount: 800, split: { mode: "equal", members: [ADA, THEO] } }));
    });
    expect(list.map((n) => n.after?.id)).toEqual(["e2"]);
  });
});

describe("notices: deleting", () => {
  it("tells everyone who was in it, with the share they had", () => {
    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 4200 }));
    const list = run(b, (b) => b.push("expense", "e1", "delete", {}));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    expect(list[0]).toMatchObject({ change: "deleted", before: { share: 1050 } });
    expect(list[0]!.after).toBeUndefined();
  });

  it("deleting what was already gone, or never there, tells nobody", () => {
    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 4200 }));
    b.push("expense", "e1", "delete", {});
    expect(run(b, (b) => b.push("expense", "e1", "delete", {}))).toEqual([]);
    expect(run(b, (b) => b.push("expense", "nope", "delete", {}))).toEqual([]);
  });

  it("a member removed from the group since is nobody to tell", () => {
    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 4200 }));
    b.push("member", ADA, "delete", {});
    expect(to(run(b, (b) => b.push("expense", "e1", "delete", {})))).toEqual([MARIE, SAM]);
  });
});

describe("notices: transfers", () => {
  const transfer = (from: string, toMember: string, amount: number, extra: Record<string, unknown> = {}) => ({
    fromMember: from, toMember, amountMinor: amount, currency: "EUR", rateToBase: "1",
    baseAmountMinor: amount, occurredAt: 1000, createdAt: 1000, ...extra,
  });

  it("recording one tells the other side", () => {
    const b = group();
    const list = run(b, (b) => b.push("settlement", "s1", "create", transfer(THEO, MARIE, 2000)));
    expect(list).toEqual([{
      to: MARIE, involved: true, by: THEO, change: "added", moved: [], baseCurrency: "EUR",
      after: {
        kind: "transfer", id: "s1", fromMember: THEO, toMember: MARIE,
        amountMinor: 2000, currency: "EUR", baseAmountMinor: 2000,
      },
    }]);
  });

  it("recorded by a third person, both sides hear", () => {
    const b = group();
    expect(to(run(b, (b) => b.push("settlement", "s1", "create", transfer(SAM, MARIE, 2000))))).toEqual([MARIE, SAM]);
  });

  it("an edit tells both sides before and after when it moved money, and nobody when it didn't", () => {
    const b = group();
    b.push("settlement", "s1", "create", transfer(SAM, MARIE, 2000));
    expect(run(b, (b) => b.push("settlement", "s1", "update", transfer(SAM, MARIE, 2000, { note: "cash", occurredAt: 9 }))))
      .toEqual([]);
    const list = run(b, (b) => b.push("settlement", "s1", "update", transfer(SAM, ADA, 2500)));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    expect(list[0]!.moved).toEqual(["amount", "sides"]);
  });

  it("a delete tells both sides", () => {
    const b = group();
    b.push("settlement", "s1", "create", transfer(SAM, MARIE, 2000));
    const list = run(b, (b) => b.push("settlement", "s1", "delete", {}));
    expect(to(list)).toEqual([MARIE, SAM]);
    expect(list[0]!.change).toBe("deleted");
  });
});

describe("notices: a phone that wants everything", () => {
  const sub = { endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" };

  it("gets the entries it isn't in, with no share and nothing paid", () => {
    const b = group();
    const list = runAll(b, (b) => b.push("expense", "e1", "create", expensePatch({
      amount: 1000, split: { mode: "equal", members: [MARIE, THEO] },
    })));
    expect(to(list)).toEqual([ADA, MARIE, SAM]);
    const ada = list.find((n) => n.to === ADA)!;
    expect(ada).toMatchObject({ involved: false, after: { share: null, paid: null } });
    expect(wantsNotice(sub, ada)).toBe(false);
    expect(wantsNotice({ ...sub, scope: "own" }, ada)).toBe(false);
    expect(wantsNotice({ ...sub, scope: "all" }, ada)).toBe(true);
    expect(wantsNotice(sub, list.find((n) => n.to === MARIE)!)).toBe(true);
  });

  it("still hears nothing about an edit that moved no money, nor the author about their own", () => {
    const b = group();
    b.push("expense", "e1", "create", expensePatch({ amount: 1000 }));
    expect(runAll(b, (b) => b.push("expense", "e1", "update", { description: "Supper" }))).toEqual([]);
    expect(to(runAll(b, (b) => b.push("expense", "e1", "delete", {})))).not.toContain(THEO);
  });
});

describe("notices: nothing else is news", () => {
  it("members, rates, identity and a group rename tell nobody", () => {
    const b = group();
    const list = runAll(b, (b) => {
      b.push("member", "zed", "create", { name: "zed", colorSeed: 9 });
      b.push("rate", "USD", "create", { rate: "0.9", source: "typed", asOf: 1 });
      b.push("identity", "node1", "update", { push: null });
      b.push("group", GROUP, "update", { name: "Trip!" });
    });
    expect(list).toEqual([]);
  });
});
