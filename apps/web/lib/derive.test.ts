import { beforeEach, describe, expect, it } from "vitest";
import type { ExchangeRate, Expense, Group, Member, Settlement } from "@bida/core";
import { derive, differences, testing, type GroupRows } from "./derive";

/** A small seeded generator, so a failure names its seed and replays. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;
  return { next, int, pick };
}
type R = ReturnType<typeof rng>;

const PEOPLE = ["ada", "bo", "cy", "dee"];
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 3, 1, 12);

/**
 * The tables as `groupRows` reads them: each row stamped as lib/db/fold.ts
 * stamps it, in id order. Every write here makes new row objects, as a fresh
 * read of IndexedDB does.
 */
class Tables {
  revs = 0;
  group: Group & { rev?: string } = { id: "g", name: "Trip", baseCurrency: "EUR", createdAt: 0, rev: "1" };
  members = new Map<string, Member & { rev?: string }>();
  expenses = new Map<string, Expense & { rev?: string }>();
  settlements = new Map<string, Settlement & { rev?: string }>();
  rates = new Map<string, ExchangeRate & { rev?: string }>();
  pending = 0;

  rev(): string {
    return `${++this.revs} x`;
  }

  rows(): GroupRows {
    const sorted = <T extends { id: string }>(m: Map<string, T>) =>
      [...m.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => ({ ...r }));
    return {
      group: { ...this.group }, members: sorted(this.members), expenses: sorted(this.expenses),
      settlements: sorted(this.settlements), rates: sorted(this.rates), pending: this.pending,
    };
  }
}

function expense(r: R, t: Tables, id: string): Expense & { rev?: string } {
  const currency = r.pick(["EUR", "EUR", "EUR", "MAD", "TND"]);
  const amount = r.pick([0, 1, 999, 12_345, 2 ** 33]);
  const who = PEOPLE.filter(() => r.next() < 0.6);
  const day = T0 - r.int(5) * DAY;
  return {
    id, groupId: "g", description: id,
    // Same days, same minutes, date-only rows: ties are the point.
    occurredAt: day + r.pick([0, 0, 60_000, 3_600_000]), dateOnly: r.next() < 0.2 ? true : null,
    createdAt: r.next() < 0.5 ? T0 : T0 + r.int(3),
    amountMinor: amount, currency, rateToBase: currency === "EUR" ? "1" : "0.1",
    baseAmountMinor: currency === "EUR" ? amount : Math.round(amount / 10),
    rateSource: currency !== "EUR" && r.next() < 0.5 ? "typed" : null,
    paidBy: r.pick(PEOPLE),
    split: r.next() < 0.1 ? { mode: "exact", amounts: { ada: 1 } }
      : r.next() < 0.5 ? { mode: "equal", members: who }
      : { mode: "shares", weights: Object.fromEntries(who.map((m) => [m, 1 + r.int(3)])) },
    kind: r.next() < 0.15 ? "income" : null,
    deletedAt: r.next() < 0.1 ? 1 : null,
    rev: t.rev(),
  } as Expense & { rev?: string };
}

function transfer(r: R, t: Tables, id: string): Settlement & { rev?: string } {
  const amount = r.pick([1, 500, 70_000]);
  return {
    id, groupId: "g", fromMember: r.pick(PEOPLE), toMember: r.pick(PEOPLE), amountMinor: amount,
    currency: "EUR", rateToBase: "1", baseAmountMinor: amount,
    occurredAt: T0 - r.int(5) * DAY, deletedAt: r.next() < 0.1 ? 1 : null, rev: t.rev(),
  };
}

function seeded(r: R, size: number): Tables {
  const t = new Tables();
  for (const id of PEOPLE) t.members.set(id, { id, groupId: "g", name: id.toUpperCase(), colorSeed: 0, rev: t.rev() });
  t.rates.set("MAD", { id: "MAD", groupId: "g", rate: "0.09", source: "fetched", asOf: 0, rev: t.rev() });
  for (let i = 0; i < size; i++) t.expenses.set(`e${String(i).padStart(4, "0")}`, expense(r, t, `e${String(i).padStart(4, "0")}`));
  for (let i = 0; i < size / 5; i++) t.settlements.set(`s${i}`, transfer(r, t, `s${i}`));
  return t;
}

/** One save, one pull, one sync tick: what moves between two answers. */
function step(r: R, t: Tables): void {
  const roll = r.next();
  if (roll < 0.03) {
    const m = t.members.get(r.pick(PEOPLE))!;
    t.members.set(m.id, { ...m, name: `${m.name}!`, deletedAt: r.next() < 0.3 ? 1 : null, rev: t.rev() });
    return;
  }
  if (roll < 0.05) {
    t.rates.set("MAD", { ...t.rates.get("MAD")!, rate: r.pick(["0.08", "0.09", "0.1"]), rev: t.rev() });
    return;
  }
  if (roll < 0.06) {
    t.group = { ...t.group, name: `${t.group.name}.`, rev: t.rev() };
    return;
  }
  if (roll < 0.1) {
    t.pending += 1;
    return;
  }
  // A pull of a long trip: past the point of moving the answer.
  const many = roll < 0.13 ? testing.MOST_MOVED + 1 : 1 + r.int(4);
  for (let n = 0; n < many; n++) {
    const onTransfer = r.next() < 0.25;
    const table = onTransfer ? t.settlements : t.expenses;
    const ids = [...table.keys()];
    const fresh = r.next() < 0.3;
    const id = fresh ? `${onTransfer ? "s" : "e"}n${t.revs}` : r.pick(ids);
    const was = table.get(id);
    if (was && r.next() < 0.3) {
      const flipped = { ...was, deletedAt: was.deletedAt ? null : 2, rev: t.rev() };
      (table as Map<string, Expense | Settlement>).set(id, flipped);
    } else if (was && !onTransfer && r.next() < 0.3) {
      // A move in time alone: the same entry in a new place.
      t.expenses.set(id, { ...(was as Expense), occurredAt: was.occurredAt - DAY, rev: t.rev() });
    } else {
      (table as Map<string, Expense | Settlement>).set(id, onTransfer ? transfer(r, t, id) : expense(r, t, id));
    }
  }
}

describe("derive", () => {
  beforeEach(() => testing.forget());

  it("moves the last answer to the one a full sum gives, read after read", () => {
    for (let seed = 1; seed <= 24; seed++) {
      testing.forget();
      const r = rng(seed);
      const t = seeded(r, 60);
      derive(t.rows());
      for (let i = 0; i < 30; i++) {
        step(r, t);
        const rows = t.rows();
        const got = derive(rows);
        expect(differences(got, testing.whole(rows)), `seed ${seed}, step ${i}`).toEqual([]);
      }
    }
  });

  it("hands back the same lists and maps when no entry moved", () => {
    const t = seeded(rng(3), 30);
    const first = derive(t.rows());
    t.pending = 4;
    const next = derive(t.rows());
    expect(next).not.toBe(first);
    expect(next.pendingOps).toBe(4);
    expect(next.expenses).toBe(first.expenses);
    expect(next.expenseById).toBe(first.expenseById);
    expect(next.memberById).toBe(first.memberById);
    expect(next.members).toBe(first.members);
  });

  it("keeps the members' objects through a save, so a row's memo holds", () => {
    const r = rng(4);
    const t = seeded(r, 30);
    const first = derive(t.rows());
    t.expenses.set("e9999", expense(r, t, "e9999"));
    const next = derive(t.rows());
    expect(next.memberById).toBe(first.memberById);
    expect(next.nameOf).toBe(first.nameOf);
    expect(next.withTombstones).not.toBe(first.withTombstones);
    expect(next.withTombstones.expenses.e9999).toBeDefined();
    expect(first.withTombstones.expenses.e9999).toBeUndefined();
  });

  it("adds everything up again for rows written before there were stamps", () => {
    const r = rng(5);
    const t = seeded(r, 80);
    for (const [id, e] of t.expenses) t.expenses.set(id, { ...e, rev: undefined });
    derive(t.rows());
    // Unstamped, every row reads as moved: past the limit, so a full sum, and right.
    const e = t.expenses.get("e0001")!;
    t.expenses.set("e0001", { ...e, amountMinor: e.amountMinor + 7, baseAmountMinor: e.baseAmountMinor + 7 });
    const rows = t.rows();
    expect(differences(derive(rows), testing.whole(rows))).toEqual([]);
  });

  it("starts over when the group changes, not from another group's answer", () => {
    const a = seeded(rng(6), 20);
    const b = seeded(rng(7), 20);
    b.group = { ...b.group, id: "h" };
    derive(a.rows());
    const rows = b.rows();
    expect(differences(derive(rows), testing.whole(rows))).toEqual([]);
  });
});
