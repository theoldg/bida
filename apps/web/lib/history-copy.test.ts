import { beforeEach, describe as suite, expect, it } from "vitest";
import { activityFeed, type Member, type Revision } from "@hajsik/core";
import { db } from "./db/dexie";
import { opsForGroup } from "./db/fold";
import { addExpense, createGroup, editExpense } from "./db/commands";
import { describe } from "./history-copy";

/**
 * The history and restore screens both render every revision the log holds, so
 * `describe` has to be total over anything the command layer can write. It is
 * called inside a render, where one throw takes the whole app down — these
 * tests exist because it did.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(),
    d.groupKeys.clear(), d.identities.clear(),
  ]);
}

/** Every revision of a group, described exactly as the screens describe them. */
async function described(groupId: string): Promise<{ rev: Revision; said: string }[]> {
  const members = await db().members.where("groupId").equals(groupId).toArray();
  const byId = new Map<string, Member>(members.map((m) => [m.id, m]));
  const group = await db().groups.get(groupId);
  return activityFeed(await opsForGroup(groupId)).map((rev) => ({
    rev,
    said: describe(rev, byId.get(rev.op.actor)?.name ?? "Someone", byId, group!.baseCurrency).what,
  }));
}

async function expenseIn(base: string, currency: string) {
  const { groupId, memberId: theo } = await createGroup({
    name: "Siurek", baseCurrency: base, myName: "Theo",
  });
  const expenseId = await addExpense(groupId, theo, {
    description: "Beers",
    occurredAt: Date.now(),
    amountMinor: 10_000,
    currency,
    rateToBase: "1",
    paidBy: theo,
    split: { mode: "equal", members: [theo] },
  });
  return { groupId, theo, expenseId };
}

suite("describe", () => {
  beforeEach(wipe);

  it("names a currency change that left the figure alone", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    // The same number of minor units at a rate of 1: the amount fields are all
    // unchanged, so the revision carries `currency` and nothing else.
    await editExpense(groupId, theo, expenseId, { currency: "PLN", rateToBase: "1" });

    const [latest] = await described(groupId);
    expect(latest!.rev.changes.map((c) => c.field)).toEqual(["currency"]);
    expect(latest!.said).toBe("Theo changed the currency");
  });

  it("names a rate change that left the figure alone", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "PLN");
    // 100.00 PLN at 1.000 and at 1.0000 are the same 10000 minor units.
    await editExpense(groupId, theo, expenseId, { rateToBase: "1.0000" });

    const [latest] = await described(groupId);
    expect(latest!.rev.changes.map((c) => c.field)).toEqual(["rateToBase"]);
    expect(latest!.said).toBe("Theo changed the rate");
  });

  it("still calls a moved figure an amount change", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { amountMinor: 12_500 });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo changed the amount");
  });

  it("describes every revision a whole group's life can produce", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { currency: "PLN", rateToBase: "1" });
    await editExpense(groupId, theo, expenseId, { rateToBase: "4.30" });
    await editExpense(groupId, theo, expenseId, { description: "Beers and chips" });

    const all = await described(groupId);
    expect(all.length).toBeGreaterThan(4);
    for (const { said } of all) expect(said).not.toBe("");
  });
});
