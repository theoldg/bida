import { beforeEach, describe, expect, it } from "vitest";
import { atCurrentRates, computeBalances, entityHistory, foldOps, settleUp } from "@bida/core";
import { db } from "./dexie";
import { rebuild } from "./fold";
import { getDevice, getMe, updateDevice } from "./device";
import {
  addExpense,
  addMember,
  claimIdentity,
  clearRate,
  convertToExpense,
  convertToSettlement,
  createGroup,
  deleteExpense,
  editExpense,
  editSettlement,
  forgetGroup,
  publishExistingClaims,
  healGroup,
  recordSettlement,
  removeMember,
  saveGroupKey,
  setRate,
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
    d.identities.clear(), d.rates.clear(),
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
  const rates = await db().rates.where("groupId").equals(groupId).toArray();
  expect(Object.fromEntries(rates.map((r) => [r.id, r]))).toEqual(folded.rates);
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
    expect((await db().identities.get([groupId, node]))?.memberId).toBe(theo);

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
    expect((await db().identities.get([groupId, node]))?.memberId).toBe(theo);
    expect(await db().groups.get(groupId)).toBeDefined();

    // Idempotent: a second run has nothing left to publish.
    await publishExistingClaims();
    expect(await db().ops.where("entityId").equals(node).count()).toBe(1);
  });

  // A device's identity id is its HLC node id — one string per install, the
  // same in every group it joins. Keyed by that alone, the second group's
  // claim overwrote the first's and re-folding either deleted the other.
  it("keeps this device's claim in two groups apart", async () => {
    const a = await trip();
    const b = await trip();
    const node = (await db().device.get("device"))!.nodeId;
    await claimIdentity(b.groupId, b.marie);

    expect((await db().identities.get([a.groupId, node]))?.memberId).toBe(a.theo);
    expect((await db().identities.get([b.groupId, node]))?.memberId).toBe(b.marie);

    // And re-folding one group leaves the other group's claim standing.
    await rebuild(a.groupId);
    expect((await db().identities.get([b.groupId, node]))?.memberId).toBe(b.marie);
    expect((await db().identities.get([a.groupId, node]))?.memberId).toBe(a.theo);
    await assertMaterialisedMatchesLog(a.groupId);
    await assertMaterialisedMatchesLog(b.groupId);
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

  it("seats everyone named on the create screen, and only you are this device", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech",
      baseCurrency: "EUR",
      myName: "Theo",
      otherNames: ["Marie", "Sam"],
    });

    const members = await db().members.where("groupId").equals(groupId).toArray();
    expect(members.map((m) => m.name).sort()).toEqual(["Marie", "Sam", "Theo"]);
    // The others are people in the group, not claims: this phone is still only
    // Theo, and their own devices claim them when they open the link.
    expect(await getMe(groupId)).toBe(theo);
    expect(await db().identities.where("groupId").equals(groupId).count()).toBe(1);
  });

  it("keeps the group secret out of the op log entirely", async () => {
    const { groupId } = await trip();
    const key = await db().groupKeys.get(groupId);
    const log = JSON.stringify(await db().ops.toArray());

    expect(key!.secret.length).toBeGreaterThan(0);
    expect(log).not.toContain(key!.secret);
  });

  // The fold defaults every absent field, so a create that spells out
  // `receiptItems: null` spends bytes in the log and a row in the entry's
  // history to say nothing. See `only` in commands.ts.
  it("writes no field a create would only be defaulting", async () => {
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
    const settlementId = await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 14000,
      currency: "EUR", rateToBase: "1", occurredAt: Date.now(),
    });

    const patchOf = async (id: string) =>
      (await db().ops.where("entityId").equals(id).first())!.patch;
    expect(Object.keys(await patchOf(expenseId)).sort()).toEqual([
      "amountMinor", "baseAmountMinor", "createdAt", "currency", "description",
      "occurredAt", "paidBy", "rateToBase", "split",
    ]);
    // No `note`: this transfer was recorded without one.
    expect(Object.keys(await patchOf(settlementId)).sort()).toEqual([
      "amountMinor", "baseAmountMinor", "createdAt", "currency", "fromMember",
      "occurredAt", "rateToBase", "toMember",
    ]);
    await assertMaterialisedMatchesLog(groupId);
  });

  // A backdated receipt prints a day and no hour, and the entry says that
  // itself rather than leaving its midnight stamp to be read as a time
  // (`dateOnly`, core/types.ts).
  it("keeps a day without a time as a fact on the entry, through an edit", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await addExpense(groupId, theo, {
      description: "Lidl",
      occurredAt: new Date(2026, 3, 2).getTime(),
      dateOnly: true,
      amountMinor: 3200,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    expect((await db().expenses.get(id))!.dateOnly).toBe(true);

    // The whole-entity write carries it through an edit that never went near
    // the date — otherwise a rename would hand the row back its 00:00.
    await editExpense(groupId, theo, id, { description: "Lidl, barbecue" });
    expect((await db().expenses.get(id))!.dateOnly).toBe(true);
    await assertMaterialisedMatchesLog(groupId);
  });

  // The one create that must keep writing `deletedAt: null`: a rate is keyed by
  // its currency, so setting one the group cleared lands on the tombstoned row.
  it("revives a cleared rate, which is why that create still writes its null", async () => {
    const { groupId, theo } = await trip();
    await setRate(groupId, theo, "MAD", "0.0921", "typed", 1);
    await clearRate(groupId, theo, "MAD");
    expect((await db().rates.get([groupId, "MAD"]))?.deletedAt).toBeTruthy();

    await setRate(groupId, theo, "MAD", "0.095", "typed", 2);

    const row = await db().rates.get([groupId, "MAD"]);
    expect(row?.deletedAt).toBeFalsy();
    expect(row?.rate).toBe("0.095");
    await assertMaterialisedMatchesLog(groupId);
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

  it("an edit writes the whole entry, minus the two fields that never ride along", async () => {
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

    // Whole, so the stored entry is always a version somebody looked at.
    expect(Object.keys(update.patch).sort()).toEqual([
      "amountMinor", "attachmentIds", "baseAmountMinor", "categoryId", "currency",
      "dateOnly", "description", "kind", "occurredAt", "paidBy", "payers", "rateToBase",
      "receiptAssignments", "receiptDiscounts", "receiptInvolved", "receiptItems",
      "receiptTax", "receiptText", "receiptTip",
      "split",
    ]);
    // Lifecycle and identity never: a stale content save must not re-tombstone
    // what a healer just put back, or move the field list order breaks ties on.
    for (const never of ["deletedAt", "createdAt", "id", "groupId"]) {
      expect(update.patch).not.toHaveProperty(never);
    }
    expect(update.patch["paidBy"]).toBe(marie);
  });

  // The form posts its whole draft, so these say what a hand-passed single
  // field cannot: what the log carries on an ordinary Save, and what happens
  // when two phones save over each other.
  describe("an edit that sends the whole form back", () => {
    /** Exactly what `/g/entry/edit` posts on Save, for an untouched expense. */
    async function draftOf(expenseId: string) {
      const e = (await db().expenses.get(expenseId))!;
      return {
        kind: "expense" as const,
        description: e.description,
        occurredAt: e.occurredAt,
        amountMinor: e.amountMinor,
        currency: e.currency,
        rateToBase: e.rateToBase,
        paidBy: e.paidBy,
        payers: e.payers ?? null,
        split: e.split,
        categoryId: e.categoryId ?? null,
        receiptItems: e.receiptItems ?? null,
        receiptTip: e.receiptTip ?? null,
        receiptInvolved: e.receiptInvolved ?? null,
        receiptAssignments: e.receiptAssignments ?? null,
      };
    }

    async function gelato() {
      const { groupId, theo, marie } = await trip();
      const expenseId = await addExpense(groupId, theo, {
        description: "Gelato",
        occurredAt: 1,
        amountMinor: 1250,
        currency: "EUR",
        rateToBase: "1",
        paidBy: theo,
        split: { mode: "equal", members: [theo, marie] },
      });
      return { groupId, theo, marie, expenseId };
    }

    it("writes no op at all when nothing was touched", async () => {
      const { groupId, theo, expenseId } = await gelato();
      const before = await db().ops.count();

      await editExpense(groupId, theo, expenseId, await draftOf(expenseId));

      expect(await db().ops.count()).toBe(before);
      await assertMaterialisedMatchesLog(groupId);
    });

    it("carries the entry as the saver saw it, not just the field they moved", async () => {
      const { groupId, theo, expenseId } = await gelato();

      await editExpense(groupId, theo, expenseId, {
        ...(await draftOf(expenseId)),
        description: "Ice cream",
      });

      const update = (await db().ops.where("entityId").equals(expenseId).toArray())
        .find((o) => o.kind === "update")!;
      expect(update.patch["description"]).toBe("Ice cream");
      expect(update.patch["amountMinor"]).toBe(1250);
      expect(update.patch["split"]).toEqual({ mode: "equal", members: expect.any(Array) });
    });

    // A device that has caught up posts the entry including whatever it just
    // pulled, so both changes survive — the ordinary case, and the one people
    // actually hit.
    it("keeps both when the second device has seen the first", async () => {
      const { groupId, theo, marie, expenseId } = await gelato();

      await editExpense(groupId, theo, expenseId, {
        ...(await draftOf(expenseId)), amountMinor: 2000,
      });
      await editExpense(groupId, marie, expenseId, {
        ...(await draftOf(expenseId)), description: "Ice cream",
      });

      await rebuild(groupId);
      const after = (await db().expenses.get(expenseId))!;
      expect(after.description).toBe("Ice cream");
      expect(after.amountMinor).toBe(2000);
      await assertMaterialisedMatchesLog(groupId);
    });

    // The concurrency this rule gives up, asserted: a save from a snapshot older
    // than a peer's edit posts the stale value, and the later HLC wins the whole
    // entity. In return every result is a version somebody saw — never an amount
    // beside a split that doesn't sum to it. The loser stays in the log and
    // history (docs/invariants.md).
    it("lets the last edit win the whole entry, when the second never saw the first", async () => {
      const { groupId, theo, marie, expenseId } = await gelato();
      // Taken before Theo's save: Marie's phone is offline and still holds this.
      const stale = await draftOf(expenseId);

      await editExpense(groupId, theo, expenseId, { ...stale, amountMinor: 2000 });
      await editExpense(groupId, marie, expenseId, { ...stale, description: "Ice cream" });

      await rebuild(groupId);
      const after = (await db().expenses.get(expenseId))!;
      expect(after.description).toBe("Ice cream");
      // Theo's amount is gone — Marie's whole entry replaced it.
      expect(after.amountMinor).toBe(1250);
      // And the entry is coherent: the base figure belongs to this amount.
      expect(after.baseAmountMinor).toBe(1250);

      // Both ops stay in the log, so the edit that lost is still readable.
      const updates = (await db().ops.where("entityId").equals(expenseId).toArray())
        .filter((o) => o.kind === "update");
      expect(updates).toHaveLength(2);
      await assertMaterialisedMatchesLog(groupId);
    });

    it("leaves no revision in the log for an untouched save", async () => {
      const { groupId, theo, expenseId } = await gelato();
      await editExpense(groupId, theo, expenseId, await draftOf(expenseId));

      const ops = await db().ops.where("entityId").equals(expenseId).toArray();
      expect(entityHistory(ops, expenseId)).toHaveLength(1);
    });
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
    // Having no co-sponsors is the absence of the field, not a stored null.
    expect(stored && "payers" in stored).toBe(false);
    expect(stored?.paidBy).toBe(marie);
  });

  it("keeps the two payer fields in step, and writes nothing when they don't change", async () => {
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
    // Derived together — `paidBy` must never name somebody absent from `payers`.
    expect(first.patch["payers"]).toEqual({ [theo]: 2_000, [marie]: 4_000 });
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

  it("deletes by tombstone, so the log still holds what was there", async () => {
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
    await deleteExpense(groupId, theo, expenseId, "double entry");

    const row = await db().expenses.get(expenseId);
    expect(row?.deletedAt).toBeTruthy();
    // The row itself is untouched under the tombstone — nothing is erased.
    expect(row?.description).toBe("Hammam");
    await assertMaterialisedMatchesLog(groupId);
  });

  it("forgetting a group only hides it on this phone — no op, membership untouched, claim dropped", async () => {
    const { groupId, theo, marie } = await trip();
    const before = await db().ops.count();

    await forgetGroup(groupId);

    expect(await db().ops.count()).toBe(before);
    expect((await db().members.get(theo))?.deletedAt).toBeFalsy();
    expect((await db().members.get(marie))?.deletedAt).toBeFalsy();
    expect((await db().groups.get(groupId))?.archivedAt).toBeFalsy();
    expect(await getMe(groupId)).toBeUndefined();
    expect((await getDevice()).leftGroups).toContain(groupId);
    await assertMaterialisedMatchesLog(groupId);

    // Opening the invite link again surfaces the group back on the list, and
    // asks who is holding the phone rather than assuming.
    const secret = (await db().groupKeys.get(groupId))!.secret;
    await saveGroupKey(groupId, secret);
    expect((await getDevice()).leftGroups).not.toContain(groupId);
    expect(await getMe(groupId)).toBeUndefined();

    // Answering as somebody else is a switch on the log, filed under the
    // member the phone last spoke for.
    const node = (await getDevice()).nodeId;
    await claimIdentity(groupId, marie);
    expect(await getMe(groupId)).toBe(marie);
    const ops = (await db().ops.where("entityId").equals(node).toArray())
      .sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
    expect(ops.map((o) => [o.kind, o.patch["memberId"], o.actor])).toEqual([
      ["create", theo, theo],
      ["update", marie, theo],
    ]);

    // Answering as the same person again writes nothing.
    await forgetGroup(groupId);
    const count = await db().ops.count();
    await claimIdentity(groupId, marie);
    expect(await getMe(groupId)).toBe(marie);
    expect(await db().ops.count()).toBe(count);
    await assertMaterialisedMatchesLog(groupId);
  });

  /**
   * The race the members screen's refusal can't cover: offline, one phone
   * removes Marie while the other writes a transfer to her. `removeMember`
   * doesn't refuse, so these tests stand in for that merge.
   */
  it("puts back a member removed while an entry still named them", async () => {
    const { groupId, theo, marie } = await trip();
    await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 3000,
      currency: "EUR", rateToBase: "1", occurredAt: 2,
    });
    await removeMember(groupId, theo, marie);
    expect((await db().members.get(marie))?.deletedAt).toBeTruthy();

    expect(await healGroup(groupId)).toBe(1);

    expect((await db().members.get(marie))?.deletedAt).toBeNull();
    await assertMaterialisedMatchesLog(groupId);

    // Idempotent: a member who is back is no longer stranded, so a second run
    // — another screen, another device — writes nothing.
    const ops = await db().ops.count();
    expect(await healGroup(groupId)).toBe(0);
    expect(await db().ops.count()).toBe(ops);
  });

  it("puts back a rate cleared while entries were still written in it", async () => {
    // The member race, one entity over: one phone clears MAD, the other —
    // offline — writes a dinner in MAD. `clearRate` itself doesn't refuse,
    // which is what lets this stand in for the merge.
    const { groupId, theo, marie } = await trip();
    await setRate(groupId, theo, "MAD", "0.0921", "typed", 1);
    await addExpense(groupId, theo, {
      description: "Nomad", occurredAt: 1, amountMinor: 62_000, currency: "MAD",
      rateToBase: "0.0921", paidBy: theo, split: { mode: "equal", members: [theo, marie] },
    });
    await clearRate(groupId, theo, "MAD");
    expect((await db().rates.get([groupId, "MAD"]))?.deletedAt).toBeTruthy();

    expect(await healGroup(groupId)).toBe(1);

    expect((await db().rates.get([groupId, "MAD"]))?.deletedAt).toBeNull();
    await assertMaterialisedMatchesLog(groupId);

    // Idempotent, and the lift is not an edit to the number itself.
    const ops = await db().ops.count();
    expect(await healGroup(groupId)).toBe(0);
    expect(await db().ops.count()).toBe(ops);
    expect((await db().rates.get([groupId, "MAD"]))?.rate).toBe("0.0921");
  });

  it("leaves a cleared rate nothing is written in alone", async () => {
    const { groupId, theo } = await trip();
    await setRate(groupId, theo, "MAD", "0.0921", "typed", 1);
    await clearRate(groupId, theo, "MAD");

    expect(await healGroup(groupId)).toBe(0);
    expect((await db().rates.get([groupId, "MAD"]))?.deletedAt).toBeTruthy();
  });

  /**
   * The name is the key (core/names.ts). The refusal on the field still stands
   * — it catches every case one phone can see both halves of — but this is what
   * holds when two phones cannot see each other.
   */
  it("mints one member when two phones add the same name", async () => {
    const { groupId, theo } = await trip();
    const first = await addMember(groupId, theo, "Ana");
    // The second phone, offline, typing it the way people actually type it.
    const second = await addMember(groupId, theo, "  ana  ");

    expect(second).toBe(first);
    await rebuild(groupId);
    const anas = (await db().members.where("groupId").equals(groupId).toArray())
      .filter((m) => m.name.trim().toLowerCase() === "ana");
    expect(anas).toHaveLength(1);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("returns the person, not a stranger with their name, when they are re-added", async () => {
    const { groupId, theo } = await trip();
    const ana = await addMember(groupId, theo, "Ana");
    await removeMember(groupId, theo, ana);

    expect(await addMember(groupId, theo, "Ana")).toBe(ana);
    expect((await db().members.get(ana))?.deletedAt).toBeNull();
  });

  /**
   * The other half of healing, and the one the registry cannot hold: which
   * member this phone is. Decided in docs/invariants.md — the removal always
   * gives way, and forgetting the group is the exit that ends the argument.
   */
  it("puts this phone's own member back, whatever the reason for the removal", async () => {
    const { groupId, theo } = await trip();
    // No entry names Theo: the registered healers see nothing to repair, and
    // he comes back anyway, because this phone is him.
    await removeMember(groupId, theo, theo);
    expect((await db().members.get(theo))?.deletedAt).toBeTruthy();

    expect(await healGroup(groupId)).toBe(1);

    expect((await db().members.get(theo))?.deletedAt).toBeNull();
    await assertMaterialisedMatchesLog(groupId);
    expect(await healGroup(groupId)).toBe(0);
  });

  it("heals nothing on a phone that hasn't said who it is", async () => {
    const { groupId, theo, marie } = await trip();
    await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 3000,
      currency: "EUR", rateToBase: "1", occurredAt: 2,
    });
    await removeMember(groupId, theo, marie);
    // A device with no claim has no honest name to sign a repair with.
    await updateDevice({ meByGroup: {} });

    expect(await healGroup(groupId)).toBe(0);
    expect((await db().members.get(marie))?.deletedAt).toBeTruthy();
  });

  it("leaves an ordinary departure alone", async () => {
    const { groupId, theo, marie, sam } = await trip();
    await addExpense(groupId, theo, {
      description: "Dinner", occurredAt: 1, amountMinor: 9000, currency: "EUR",
      rateToBase: "1", paidBy: theo, split: { mode: "equal", members: [theo, sam] },
    });
    await removeMember(groupId, theo, marie);

    expect(await healGroup(groupId)).toBe(0);
    expect((await db().members.get(marie))?.deletedAt).toBeTruthy();
  });

  // The defect this exists for: a departed member kept whatever balance they
  // left with, the balances screen offered the settle-up row that would square
  // them off, and the form that row opened refused the name it opened with.
  it("gives a stranded member's balance a way out again", async () => {
    const { groupId, theo, marie, sam } = await trip();
    await addExpense(groupId, theo, {
      description: "Dinner", occurredAt: 1, amountMinor: 9000, currency: "EUR",
      rateToBase: "1", paidBy: theo, split: { mode: "equal", members: [theo, marie, sam] },
    });
    await removeMember(groupId, theo, marie);

    await healGroup(groupId);

    const folded = async () =>
      atCurrentRates(foldOps(await db().ops.where("groupId").equals(groupId).toArray()));
    const state = await folded();
    const balances = computeBalances(state);
    const live = new Set(Object.values(state.members).filter((m) => !m.deletedAt).map((m) => m.id));
    const rows = settleUp(balances.byMember);
    expect(balances.byMember[marie]).toBe(-3000);
    // Every side of every settle-up row is somebody a picker can still offer,
    // which is the rule the transfer form holds Save on (lib/entry-check.ts).
    expect(rows.flatMap((t) => [t.from, t.to]).filter((id) => !live.has(id))).toEqual([]);

    for (const t of rows) {
      await recordSettlement(groupId, theo, {
        fromMember: t.from, toMember: t.to, amountMinor: t.amountMinor,
        currency: "EUR", rateToBase: "1", occurredAt: 3,
      });
    }

    expect(Object.values(computeBalances(await folded()).byMember)).toEqual([0, 0, 0]);
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

  it("turning an expense into an income carries the whole entry, and flips the sign", async () => {
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
    expect(update?.patch["kind"]).toBe("income");
    expect(update?.patch["description"]).toBe("Ferry refund");
    expect(computeBalances(foldOps(await db().ops.toArray())).byMember[theo]).toBe(-2000);
  });

  // The kind chip lets an expense/income become a transfer and back — a
  // different entity, so Save converts rather than edits (ADR-0010). Both
  // directions have to land as one append: a partial write must never leave
  // the money recorded as neither.
  it("converts an expense into a transfer, as one append that tombstones the old row", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await addExpense(groupId, theo, {
      description: "Taxi to the riad",
      occurredAt: 1,
      amountMinor: 4000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
    const before = await db().ops.count();

    const settlementId = await convertToSettlement(groupId, theo, expenseId, {
      fromMember: marie, toMember: theo, amountMinor: 2000, currency: "EUR", rateToBase: "1", occurredAt: 5,
    }, 5);

    expect(await db().ops.count()).toBe(before + 2);
    expect((await db().expenses.get(expenseId))?.deletedAt).toBeTruthy();
    expect(await db().settlements.get(settlementId)).toMatchObject({
      fromMember: marie, toMember: theo, amountMinor: 2000, baseAmountMinor: 2000,
    });
    // Both ops the conversion wrote landed in the same append.
    const written = (await db().ops.toArray()).filter((o) => o.createdAt === 5);
    expect(written.map((o) => o.entity).sort()).toEqual(["expense", "settlement"]);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("converts a transfer into an expense, seeding its split under the new id", async () => {
    const { groupId, theo, marie, sam } = await trip();
    const settlementId = await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 3000, currency: "EUR", rateToBase: "1", occurredAt: 1,
    });

    const expenseId = await convertToExpense(groupId, theo, settlementId, {
      description: "Hammam, split three ways",
      occurredAt: 5,
      amountMinor: 3000,
      currency: "EUR",
      rateToBase: "1",
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie, sam] },
    }, 5, "new-hammam-id");

    expect(expenseId).toBe("new-hammam-id");
    expect((await db().settlements.get(settlementId))?.deletedAt).toBeTruthy();
    expect(await db().expenses.get(expenseId)).toMatchObject({
      description: "Hammam, split three ways", amountMinor: 3000, paidBy: theo,
    });
    await assertMaterialisedMatchesLog(groupId);
  });

  it("edits a transfer, writing it whole and only when something moved", async () => {
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
    expect(update?.patch).toEqual({
      fromMember: marie, toMember: sam, amountMinor: 2500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 2500, occurredAt: 2, dateOnly: null, note: null,
    });

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

  it("writes a transfer's base amount unmoved when a new rate lands on the same figure", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await recordSettlement(groupId, marie, {
      fromMember: marie,
      toMember: theo,
      amountMinor: 100,
      currency: "MAD",
      rateToBase: "0.0921",
      occurredAt: 2,
    });
    // 1.00 MAD is €0.09 at either rate. The derived figure is re-derived on
    // edit, not carried, so it stays what this amount is worth.
    await editSettlement(groupId, marie, id, { rateToBase: "0.0925" });
    const [update] = (await db().ops.where("entityId").equals(id).toArray())
      .filter((o) => o.kind === "update");
    expect(update?.patch["rateToBase"]).toBe("0.0925");
    expect(update?.patch["baseAmountMinor"]).toBe(9);
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


/**
 * The rate registry. Its point is that it is *not* per-entry: setting a rate
 * moves every entry already written in that currency, which is the one thing
 * these tests have to hold onto.
 */
describe("the rate registry", () => {
  beforeEach(wipe);

  async function madExpense(groupId: string, theo: string, marie: string, rate = "0.0921") {
    return addExpense(groupId, theo, {
      description: "Dinner · Nomad",
      occurredAt: 1,
      amountMinor: 62000, // 620.00 MAD
      currency: "MAD",
      rateToBase: rate,
      paidBy: theo,
      split: { mode: "equal", members: [theo, marie] },
    });
  }

  async function stateOf(groupId: string) {
    return atCurrentRates(foldOps(await db().ops.where("groupId").equals(groupId).toArray()));
  }

  it("writes a rate as an op, and keeps one row per currency", async () => {
    const { groupId, theo } = await trip();
    await setRate(groupId, theo, "MAD", "0.0921", "fetched", 1);
    await setRate(groupId, theo, "MAD", "0.093", "typed", 2);

    const rows = await db().rates.where("groupId").equals(groupId).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "MAD", rate: "0.093", source: "typed", asOf: 2 });
    const kinds = (await db().ops.where("groupId").equals(groupId).toArray())
      .filter((o) => o.entity === "rate")
      .sort((x, y) => (x.hlc < y.hlc ? -1 : 1)).map((o) => o.kind);
    expect(kinds).toEqual(["create", "update"]);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("re-values expenses already written in that currency", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await madExpense(groupId, theo, marie);
    expect((await db().expenses.get(expenseId))?.baseAmountMinor).toBe(5710);

    await setRate(groupId, theo, "MAD", "0.1", "typed", 1);

    const state = await stateOf(groupId);
    expect(state.expenses[expenseId]!.baseAmountMinor).toBe(6200);
    expect(computeBalances(state).totalSpendMinor).toBe(6200);
  });

  it("re-values transfers too", async () => {
    const { groupId, theo, marie } = await trip();
    const id = await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 50000,
      currency: "MAD", rateToBase: "0.0921", occurredAt: 1,
    });
    await setRate(groupId, theo, "MAD", "0.1", "typed", 1);
    expect((await stateOf(groupId)).settlements[id]!.baseAmountMinor).toBe(5000);
  });

  it("gives a new entry the group's rate rather than whatever the form held", async () => {
    const { groupId, theo, marie } = await trip();
    await setRate(groupId, theo, "MAD", "0.1", "typed", 1);
    // A stale draft, or a scan that set the currency and kept an old rate.
    const expenseId = await madExpense(groupId, theo, marie, "0.0921");

    const row = await db().expenses.get(expenseId);
    expect(row?.rateToBase).toBe("0.1");
    expect(row?.baseAmountMinor).toBe(6200);
  });

  it("leaves an entry in a currency the registry has no row for alone", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await madExpense(groupId, theo, marie);
    await setRate(groupId, theo, "PLN", "0.23", "typed", 1);

    expect((await stateOf(groupId)).expenses[expenseId]!.baseAmountMinor).toBe(5710);
  });

  it("falls back to what each entry was saved with once the rate is cleared", async () => {
    const { groupId, theo, marie } = await trip();
    const expenseId = await madExpense(groupId, theo, marie);
    await setRate(groupId, theo, "MAD", "0.1", "typed", 1);
    expect((await stateOf(groupId)).expenses[expenseId]!.baseAmountMinor).toBe(6200);

    await clearRate(groupId, theo, "MAD");
    expect((await stateOf(groupId)).expenses[expenseId]!.baseAmountMinor).toBe(5710);
    await assertMaterialisedMatchesLog(groupId);
  });

  it("setting the same rate again writes no op", async () => {
    const { groupId, theo } = await trip();
    await setRate(groupId, theo, "MAD", "0.0921", "typed", 1);
    const before = await db().ops.count();
    await setRate(groupId, theo, "MAD", "0.0921", "typed", 99);
    expect(await db().ops.count()).toBe(before);
  });

  it("refuses a rate that isn't one, and the group's own currency", async () => {
    const { groupId, theo } = await trip();
    await expect(setRate(groupId, theo, "MAD", "0", "typed", 1)).rejects.toThrow(RangeError);
    await expect(setRate(groupId, theo, "MAD", "nope", "typed", 1)).rejects.toThrow(RangeError);
    await expect(setRate(groupId, theo, "EUR", "1", "typed", 1)).rejects.toThrow(RangeError);
  });

  // A rate's entity id is its currency code, not a random id — so two trips
  // both spending in MAD must not end up sharing one row.
  it("keeps two groups' rates for the same currency apart", async () => {
    const a = await trip();
    const b = await trip();
    await setRate(a.groupId, a.theo, "MAD", "0.0921", "typed", 1);
    await setRate(b.groupId, b.theo, "MAD", "0.5", "typed", 1);

    expect((await db().rates.get([a.groupId, "MAD"]))?.rate).toBe("0.0921");
    expect((await db().rates.get([b.groupId, "MAD"]))?.rate).toBe("0.5");
    // And a re-fold of one group doesn't take the other's row with it.
    await rebuild(a.groupId);
    expect((await db().rates.get([b.groupId, "MAD"]))?.rate).toBe("0.5");
    expect((await stateOf(a.groupId)).rates["MAD"]?.rate).toBe("0.0921");
  });
});
