import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, foldOps, readCsvGroup, type ImportPlan } from "@bida/core";
import { importGroup } from "./import";
import { db } from "../dexie";
import { getMe } from "../device";
import { parseCsv } from "../../import/csv";
import { dayStart } from "../../format";
import { groupCsv } from "../../export";
import type { GroupData } from "../../hooks";

/**
 * The write half of the import: a plan in, one batch of ops out. The
 * arithmetic is tested in `core/import.ts`; here, that the created group's
 * balances are the file's, and that the rows arrive as one event.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(), d.groupKeys.clear(),
    d.identities.clear(), d.rates.clear(),
  ]);
}

const plan = (csv: string): ImportPlan =>
  readCsvGroup(parseCsv(csv), { dayToTimestamp: dayStart });

/**
 * A file with one of everything in it: an expense split unevenly, an income,
 * a co-sponsored row with two positive columns, a transfer, a category, and a
 * row that carries no money.
 */
const FILE = [
  "Date,Description,Category,Cost,Currency,Ada,Sam,Theo",
  "",
  "2026-04-03,Riad,Lodging,300.00,EUR,200.00,-100.00,-100.00",
  "2026-04-04,Dinner,Dining out,60.00,EUR,-20.00,-20.00,40.00",
  "2026-04-05,Deposit back,General,-30.00,EUR,10.00,10.00,-20.00",
  "2026-04-06,Boat,General,100.00,EUR,20.00,30.00,-50.00",
  "2026-04-07,Cash at the airport,Payment,25.00,EUR,25.00,0.00,-25.00",
  "2026-04-08,Unapportionable,General,10.00,EUR,0.00,0.00,0.00",
  "",
  "2026-09-18,Total balance, , ,EUR,235.00,-80.00,-155.00",
  "",
].join("\n");

/** The group this phone now holds, as the balances tab would compute them. */
async function balances(groupId: string): Promise<Record<string, number>> {
  const ops = await db().ops.where("groupId").equals(groupId).toArray();
  return computeBalances(foldOps(ops)).byMember;
}

/** name -> minor units, so an assertion can be read against the file's foot. */
async function byName(groupId: string): Promise<Record<string, number>> {
  const members = await db().members.where("groupId").equals(groupId).toArray();
  const balance = await balances(groupId);
  return Object.fromEntries(members.map((m) => [m.name, balance[m.id] ?? 0]));
}

describe("a file written as a group", () => {
  beforeEach(wipe);

  it("creates the group with the file's currency as its base", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const group = await db().groups.get(groupId);
    expect(group?.name).toBe("Rome");
    expect(group?.baseCurrency).toBe("EUR");
  });

  it("puts everybody the file had a column for in it", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const members = await db().members.where("groupId").equals(groupId).toArray();
    expect(members.map((m) => m.name).sort()).toEqual(["Ada", "Sam", "Theo"]);
  });

  it("makes this phone the person the screen said it was", async () => {
    const { groupId, memberId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    expect(await getMe(groupId)).toBe(memberId);
    const sam = (await db().members.where("groupId").equals(groupId).toArray())
      .find((m) => m.name === "Sam")!;
    expect(memberId).toBe(sam.id);
  });

  it("refuses a person who is not one of the file's, rather than invent them", async () => {
    await expect(importGroup(plan(FILE), { name: "Rome", myName: "Bruno" }))
      .rejects.toThrow(/not one of the file's people/);
  });

  /** The promise the whole feature rests on. */
  it("reproduces the balances the file stated, to the cent", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    expect(await byName(groupId)).toEqual({ Ada: 23500, Sam: -8000, Theo: -15500 });
  });

  it("writes the entries and the transfer, and not the row that carried no money", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
    const settlements = await db().settlements.where("groupId").equals(groupId).toArray();
    expect(expenses).toHaveLength(4);
    expect(settlements).toHaveLength(1);
    expect(expenses.map((e) => e.description)).not.toContain("Unapportionable");
  });

  it("keeps the category on the entry, where a re-export will find it again", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
    const riad = expenses.find((e) => e.description === "Riad")!;
    expect(riad.categoryId).toBe("Lodging");
    // And the description is untouched by it.
    expect(riad.description).toBe("Riad");
    // The two protocol tokens are not categories, so they land as nothing.
    expect(expenses.find((e) => e.description === "Boat")!.categoryId).toBeUndefined();
  });

  it("reads the negative cost as an income, and nothing else as one", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
    expect(expenses.find((e) => e.description === "Deposit back")!.kind).toBe("income");
    expect(expenses.filter((e) => e.kind === "income")).toHaveLength(1);
  });

  it("dates each entry on its own day, as a day and not a time", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const riad = (await db().expenses.where("groupId").equals(groupId).toArray())
      .find((e) => e.description === "Riad")!;
    expect(riad.occurredAt).toBe(dayStart("2026-04-03"));
    expect(riad.dateOnly).toBe(true);
  });

  it("stores a single payer as paidBy alone, with no redundant payers map", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const riad = (await db().expenses.where("groupId").equals(groupId).toArray())
      .find((e) => e.description === "Riad")!;
    expect(riad.payers).toBeUndefined();
  });

  it("stores the several-payer row as a payers map that sums to the cost", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const boat = (await db().expenses.where("groupId").equals(groupId).toArray())
      .find((e) => e.description === "Boat")!;
    expect(Object.keys(boat.payers ?? {})).toHaveLength(2);
    expect(Object.values(boat.payers ?? {}).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("arrives as one batch, so the log reads as an import and not an afternoon", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    // group + three members + identity + four expenses + one transfer.
    expect(ops).toHaveLength(10);
    expect(new Set(ops.map((o) => o.createdAt)).size).toBe(1);
    // One actor, and it is the person who pressed the button.
    expect(new Set(ops.map((o) => o.actor)).size).toBe(1);
  });

  it("leaves every materialised row equal to a cold fold of the log", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    const folded = foldOps(ops);
    const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
    expect(Object.fromEntries(expenses.map((e) => [e.id, e]))).toEqual(folded.expenses);
    const settlements = await db().settlements.where("groupId").equals(groupId).toArray();
    expect(Object.fromEntries(settlements.map((s) => [s.id, s]))).toEqual(folded.settlements);
  });

  it("stores a key, so the group has an invite link like any other", async () => {
    const { groupId, secret } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    expect((await db().groupKeys.get(groupId))?.secret).toBe(secret);
  });
});

/**
 * Import then export: the balances survive. Not byte equality — one number
 * per member can't carry both sides, so who paid may read differently.
 */
describe("imported, then exported again", () => {
  beforeEach(wipe);

  it("writes a file whose foot is the foot it came in with", async () => {
    const { groupId } = await importGroup(plan(FILE), { name: "Rome", myName: "Sam" });
    const [group, members, expenses, settlements] = await Promise.all([
      db().groups.get(groupId),
      db().members.where("groupId").equals(groupId).toArray(),
      db().expenses.where("groupId").equals(groupId).toArray(),
      db().settlements.where("groupId").equals(groupId).toArray(),
    ]);
    const data = {
      group: group!,
      memberById: new Map(members.map((m) => [m.id, m])),
      expenses,
      settlements,
    } as unknown as GroupData;

    const again = plan(groupCsv(data));
    expect(again.stated).toEqual({ Ada: 23500, Sam: -8000, Theo: -15500 });
    expect(again.currency).toBe("EUR");
    expect(again.members).toEqual(["Ada", "Sam", "Theo"]);
  });
});
