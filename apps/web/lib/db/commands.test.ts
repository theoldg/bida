import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, foldOps, settleUp } from "@hajsik/core";
import { db } from "./dexie";
import { rebuild } from "./fold";
import { getDevice, getMe } from "./device";
import {
  addExpense,
  addMember,
  claimIdentity,
  createGroup,
  deleteExpense,
  editExpense,
  editSettlement,
  leaveGroup,
  publishExistingClaims,
  recordSettlement,
  restoreRevision,
  saveGroupKey,
} from "./commands";

/**
 * The command layer is the only thing in the app that writes, so it gets real
 * tests rather than smoke tests. What matters here isn't the UI — it's that
 * every write lands as an op, and that the materialised tables are always
 * exactly what re-folding the log would produce.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(), d.groupKeys.clear(),
    d.identities.clear(),
  ]);
}

/** Every materialised row must equal a cold fold of the whole log. */
async function assertMaterialisedMatchesLog(groupId: string) {
  const ops = await db().ops.where("groupId").equals(groupId).toArray();
  const folded = foldOps(ops);

  expect(await db().groups.get(groupId)).toEqual(folded.group);
  const members = await db().members.where("groupId").equals(groupId).toArray();
  expect(Object.fromEntries(members.map((m) => [m.id, m]))).toEqual(folded.members);
  const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
  expect(Object.fromEntries(expenses.map((e) => [e.id, e]))).toEqual(folded.expenses);
  const settlements = await db().settlements.where("groupId").equals(groupId).toArray();
  expect(Object.fromEntries(settlements.map((s) => [s.id, s]))).toEqual(folded.settlements);
  const identities = await db().identities.where("groupId").equals(groupId).toArray();
  expect(Object.fromEntries(identities.map((i) => [i.id, i]))).toEqual(folded.identities);
}

async function trip() {
  const { groupId, memberId: theo } = await createGroup({
    name: "Marrakech",
    baseCurrency: "EUR",
    myName: "Theo",
  });
  const marie = await addMember(groupId, theo, "Marie");
  const sam = await addMember(groupId, theo, "Sam");
  return { groupId, theo, marie, sam };
}

describe("commands", () => {
  beforeEach(wipe);

  it("records who this device is as an op, so edits can be attributed", async () => {
    const { groupId, theo, marie } = await trip();
    const node = (await db().device.get("device"))!.nodeId;

    // Creating the group already claimed it.
    expect(await getMe(groupId)).toBe(theo);
    expect((await db().identities.get(node))?.memberId).toBe(theo);

    await claimIdentity(groupId, marie);

    expect(await getMe(groupId)).toBe(marie);
    const ops = (await db().ops.where("entityId").equals(node).toArray())
      .sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
    expect(ops.map((o) => [o.kind, o.patch["memberId"], o.actor])).toEqual([
      ["create", theo, theo],
      // The switch is filed under who this phone was a moment ago.
      ["update", marie, theo],
    ]);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("publishes a claim a device made before identity was on the log", async () => {
    const { groupId, theo } = await trip();
    const node = (await db().device.get("device"))!.nodeId;
    // A device upgraded from Dexie v2: it knows who it is, the log doesn't.
    await db().ops.where("entityId").equals(node).delete();
    await db().identities.clear();

    await publishExistingClaims();

    const ops = await db().ops.where("entityId").equals(node).toArray();
    expect(ops.map((o) => [o.entity, o.kind, o.patch["memberId"]])).toEqual([
      ["identity", "create", theo],
    ]);
    expect((await db().identities.get(node))?.memberId).toBe(theo);
    expect(await db().groups.get(groupId)).toBeDefined();

    // Idempotent: a second run has nothing left to publish.
    await publishExistingClaims();
    expect(await db().ops.where("entityId").equals(node).count()).toBe(1);
  });

  it("writes nothing when you re-claim the member you already are", async () => {
    const { groupId, theo } = await trip();
    const before = await db().ops.count();

    await claimIdentity(groupId, theo);

    expect(await db().ops.count()).toBe(before);
  });

  it("creates a group with its first member and claims this device", async () => {
    const { groupId, theo } = await trip();

    const group = await db().groups.get(groupId);
    expect(group?.name).toBe("Marrakech");
    expect(group?.baseCurrency).toBe("EUR");
    expect(await getMe(groupId)).toBe(theo);
    expect(await db().groupKeys.get(groupId)).toBeTruthy();
  });

  it("keeps the group secret out of the op log entirely", async () => {
    const { groupId } = await trip();
    const key = await db().groupKeys.get(groupId);
    const log = JSON.stringify(await db().ops.toArray());

    expect(key!.secret.length).toBeGreaterThan(0);
    expect(log).not.toContain(key!.secret);
  });

  it("appends rather than mutating: an edit leaves both versions in the log", async () => {
    const { groupId, theo, marie, sam } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Riad",
      occurredAt: Date.parse("2026-04-02T10:00:00Z"),
      amountMinor: 42000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie, sam] },
    });

    await editExpense(groupId, theo, expenseId, { description: "Riad — 3 nights" }, "it was 3");

    const ops = await db().ops.where("entityId").equals(expenseId).toArray();
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.kind).sort()).toEqual(["create", "update"]);
    expect((await db().expenses.get(expenseId))?.description).toBe("Riad — 3 nights");
    await assertMaterialisedMatchesLog(groupId);
  });

  it("patches carry only what changed", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Taxi",
      occurredAt: 1,
      amountMinor: 1500,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });

    await editExpense(groupId, theo, expenseId, { paidBy: marie });
    const update = (await db().ops.where("entityId").equals(expenseId).toArray())
      .find((o) => o.kind === "update")!;

    expect(Object.keys(update.patch)).toEqual(["paidBy"]);
  });

  it("stores co-sponsors and keeps paidBy on the largest of them", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Riad",
      occurredAt: 1,
      amountMinor: 50_000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      payers: { [theo]: 10_000, [marie]: 40_000 },
      split: { mode: "equal", members: [theo, marie] },
    });

    const stored = await db().expenses.get(expenseId);
    expect(stored?.payers).toEqual({ [theo]: 10_000, [marie]: 40_000 });
    expect(stored?.paidBy).toBe(marie);
  });

  it("collapses a one-person payer map back to a plain single payer", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Taxi",
      occurredAt: 1,
      amountMinor: 1_500,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      payers: { [marie]: 1_500, [theo]: 0 },
      split: { mode: "equal", members: [theo, marie] },
    });

    const stored = await db().expenses.get(expenseId);
    expect(stored?.payers).toBeNull();
    expect(stored?.paidBy).toBe(marie);
  });

  it("writes both payer fields when an expense becomes co-sponsored, and neither when it doesn't change", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Dinner",
      occurredAt: 1,
      amountMinor: 6_000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });

    await editExpense(groupId, theo, expenseId, {
      payers: { [theo]: 2_000, [marie]: 4_000 },
    });
    const updates = () => db().ops.where("entityId").equals(expenseId).toArray()
      .then((ops) => ops.filter((o) => o.kind === "update"));

    const first = (await updates())[0]!;
    expect(Object.keys(first.patch).sort()).toEqual(["paidBy", "payers"]);
    expect(first.patch["paidBy"]).toBe(marie);

    // Re-submitting the same payers, spelled in the other order, is not a change.
    await editExpense(groupId, theo, expenseId, {
      payers: { [marie]: 4_000, [theo]: 2_000 },
    });
    expect(await updates()).toHaveLength(1);
  });

  it("recomputes the base amount when the amount, currency or rate changes", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Souk rug",
      occurredAt: 1,
      amountMinor: 180000, // 1800.00 MAD
      currency: "MAD",
      rateToBase: "0.0921",
      paidBy: marie,
      split: { mode: "equal", members: [theo, marie] },
    });

    expect((await db().expenses.get(expenseId))?.baseAmountMinor).toBe(16578);

    await editExpense(groupId, theo, expenseId, { amountMinor: 185000 });
    expect((await db().expenses.get(expenseId))?.baseAmountMinor).toBe(17039);
  });

  it("a no-op edit writes no op at all", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Mint tea",
      occurredAt: 1,
      amountMinor: 400,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    const before = await db().ops.count();

    await editExpense(groupId, theo, expenseId, {});

    expect(await db().ops.count()).toBe(before);
  });

  it("deletes by tombstone, and a restore brings the expense back", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Hammam",
      occurredAt: 1,
      amountMinor: 6000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    const createHlc = (await db().ops.where("entityId").equals(expenseId).toArray())[0]!.hlc;

    await deleteExpense(groupId, theo, expenseId, "double entry");
    expect((await db().expenses.get(expenseId))?.deletedAt).toBeTruthy();

    await restoreRevision(groupId, theo, "expense", expenseId, createHlc, "my mistake");
    expect((await db().expenses.get(expenseId))?.deletedAt).toBeFalsy();
    expect((await db().expenses.get(expenseId))?.description).toBe("Hammam");
    await assertMaterialisedMatchesLog(groupId);
  });

  it("leaving tombstones your own member, forgets this device's claim, and hides the group from this phone even though others are still in it", async () => {
    const { groupId, theo, marie } = await trip();
    await leaveGroup(groupId, theo, false);

    expect((await db().members.get(theo))?.deletedAt).toBeTruthy();
    expect((await db().members.get(marie))?.deletedAt).toBeFalsy();
    expect((await db().groups.get(groupId))?.archivedAt).toBeFalsy();
    expect(await getMe(groupId)).toBeUndefined();
    expect((await getDevice()).leftGroups).toContain(groupId);
    await assertMaterialisedMatchesLog(groupId);

    // Opening the invite link again surfaces the group back on the list.
    const secret = (await db().groupKeys.get(groupId))!.secret;
    await saveGroupKey(groupId, secret);
    expect((await getDevice()).leftGroups).not.toContain(groupId);
  });

  it("the last member leaving also archives the group, in the same batch", async () => {
    const { groupId, theo } = await trip();
    const marie = (await db().members.where("groupId").equals(groupId).toArray())
      .find((m) => m.id !== theo)!.id;
    const sam = (await db().members.where("groupId").equals(groupId).toArray())
      .find((m) => m.id !== theo && m.id !== marie)!.id;
    await leaveGroup(groupId, marie, false);
    await leaveGroup(groupId, sam, false);

    await leaveGroup(groupId, theo, true);
    expect((await db().members.get(theo))?.deletedAt).toBeTruthy();
    expect((await db().groups.get(groupId))?.archivedAt).toBeTruthy();
    await assertMaterialisedMatchesLog(groupId);
  });

  it("settlements clear a balance without inflating what the trip cost", async () => {
    const { groupId, theo, marie, sam } = await trip();
    await addExpense(groupId, theo, {
      description: "Dinner",
      occurredAt: 1,
      amountMinor: 9000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie, sam] },
    });

    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    const before = computeBalances(foldOps(ops));
    expect(before.totalSpendMinor).toBe(9000);
    expect(settleUp(before.byMember)).toHaveLength(2);

    await recordSettlement(groupId, marie, {
      fromMember: marie,
      toMember: theo,
      amountMinor: 3000,
      currency: "EUR",
      rateToBase: "1",
      occurredAt: 2,
    });

    const after = computeBalances(foldOps(await db().ops.where("groupId").equals(groupId).toArray()));
    expect(after.totalSpendMinor).toBe(9000);
    expect(after.byMember[marie]).toBe(0);
  });

  it("an income is one field on an expense, and runs the balance backwards", async () => {
    const { groupId, theo, marie, sam } = await trip();
    const id = await addExpense(groupId, theo, {
      kind: "income",
      description: "Deposit back",
      occurredAt: 1,
      amountMinor: 9000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie, sam] },
    });
    expect((await db().expenses.get(id))?.kind).toBe("income");

    const report = computeBalances(foldOps(await db().ops.where("groupId").equals(groupId).toArray()));
    expect(report.totalSpendMinor).toBe(0);
    expect(report.totalIncomeMinor).toBe(9000);
    // Theo took it all in and owes the other two their third each.
    expect(report.byMember[theo]).toBe(-6000);
    expect(report.byMember[marie]).toBe(3000);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("an ordinary expense carries no kind field at all", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await addExpense(groupId, theo, {
      description: "Taxi",
      occurredAt: 1,
      amountMinor: 1000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    const op = (await db().ops.where("entityId").equals(id).toArray())[0]!;
    expect("kind" in op.patch).toBe(false);
  });

  it("turning an expense into an income writes only that one field", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await addExpense(groupId, theo, {
      description: "Ferry refund",
      occurredAt: 1,
      amountMinor: 4000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    await editExpense(groupId, theo, id, { kind: "income" });
    const update = (await db().ops.where("entityId").equals(id).toArray())
      .find((o) => o.kind === "update");
    expect(update?.patch).toEqual({ kind: "income" });
    expect(computeBalances(foldOps(await db().ops.toArray())).byMember[theo]).toBe(-2000);
  });

  it("edits a transfer, writing only what actually changed", async () => {
    const { groupId, theo, marie, sam } = await trip();
    const id = await recordSettlement(groupId, marie, {
      fromMember: marie,
      toMember: theo,
      amountMinor: 3000,
      currency: "EUR",
      rateToBase: "1",
      occurredAt: 2,
      note: null,
    });

    // Same values in: nothing to say, so nothing is appended.
    await editSettlement(groupId, marie, id, { amountMinor: 3000, occurredAt: 2 });
    const updates = () => db().ops.where("entityId").equals(id).toArray()
      .then((ops) => ops.filter((o) => o.kind === "update"));
    expect(await updates()).toHaveLength(0);

    await editSettlement(groupId, marie, id, { toMember: sam, amountMinor: 2500 });
    const [update] = await updates();
    expect(update?.patch).toEqual({ toMember: sam, amountMinor: 2500, baseAmountMinor: 2500 });

    const stored = await db().settlements.get(id);
    expect(stored?.toMember).toBe(sam);
    expect(stored?.fromMember).toBe(marie);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("re-derives a transfer's base amount when its currency moves", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await recordSettlement(groupId, marie, {
      fromMember: marie,
      toMember: theo,
      amountMinor: 3000,
      currency: "EUR",
      rateToBase: "1",
      occurredAt: 2,
    });
    await editSettlement(groupId, marie, id, { currency: "MAD", rateToBase: "0.0921" });
    // 3000 MAD minor × 0.0921, rounded once.
    expect((await db().settlements.get(id))?.baseAmountMinor).toBe(276);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("the HLC survives a reload and keeps moving forward", async () => {
    const { groupId, theo, marie } = await trip();
    const at = Date.parse("2026-04-02T10:00:00Z");
    for (let i = 0; i < 3; i++) {
      await addExpense(groupId, theo, {
        description: `Round ${i}`,
        occurredAt: at,
        amountMinor: 1000,
        currency: "EUR",
        rateToBase: "1",
        paidBy: theo,
        split: { mode: "equal", members: [theo, marie] },
      }, at); // same wall clock every time: only the counter can separate them
    }

    const hlcs = (await db().ops.where("groupId").equals(groupId).toArray())
      .map((o) => o.hlc);
    expect(new Set(hlcs).size).toBe(hlcs.length);
    expect([...hlcs].sort()).toEqual([...hlcs].sort((a, b) => a.localeCompare(b)));

    const device = await db().device.get("device");
    expect(device!.hlcCounter).toBeGreaterThan(0);
  });

  it("rebuild from the log reproduces the materialised tables exactly", async () => {
    const { groupId, theo, marie, sam } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Riad",
      occurredAt: 1,
      amountMinor: 42000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "shares", weights: { [theo]: 1, [marie]: 2, [sam]: 1 } },
    });
    await editExpense(groupId, theo, expenseId, { description: "Riad, 3 nights" });

    const before = await db().expenses.where("groupId").equals(groupId).toArray();
    await rebuild(groupId);
    const after = await db().expenses.where("groupId").equals(groupId).toArray();

    expect(after).toEqual(before);
    await assertMaterialisedMatchesLog(groupId);
  });
});
