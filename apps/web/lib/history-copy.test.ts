import { beforeEach, describe as suite, expect, it } from "vitest";
import { activityFeed, type Member, type Revision } from "@hajsik/core";
import { db } from "./db/dexie";
import { opsForGroup } from "./db/fold";
import { addExpense, addMember, clearRate, createGroup, editExpense, removeMember, setRate }
  from "./db/commands";
import { describe } from "./history-copy";

/**
 * The history screen renders every revision the log holds, so `describe` has to
 * be total over anything the command layer can write. It is called inside a
 * render, where one throw takes the whole app down — these tests exist because
 * it did.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(),
    d.groupKeys.clear(), d.identities.clear(), d.rates.clear(),
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

  it("keeps the bookkeeping of `kind` out of the sentence", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    // The form always sends a kind; an expense is the absence of one on the
    // log, so this edit changed the amount and nothing else.
    await editExpense(groupId, theo, expenseId, { kind: "expense", amountMinor: 12_500 });

    const [latest] = await described(groupId);
    expect(latest!.rev.changes.map((c) => c.field)).not.toContain("kind");
    expect(latest!.said).toBe("Theo changed the amount");
  });

  it("still names a real crossing between the two", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { kind: "income" });
    expect((await described(groupId))[0]!.said).toBe("Theo turned this into an income");
    await editExpense(groupId, theo, expenseId, { kind: "expense" });
    expect((await described(groupId))[0]!.said).toBe("Theo turned this back into an expense");
  });

  it("names the member a membership revision is about, not the actor", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Siurek", baseCurrency: "EUR", myName: "Theo",
    });
    const marie = await addMember(groupId, theo, "Marie");
    await addMember(groupId, theo, "Sam");
    await removeMember(groupId, theo, marie);

    const said = (await described(groupId)).map((d) => d.said);
    expect(said).toContain("Theo joined the group");
    expect(said.filter((s) => s === "Theo joined the group")).toHaveLength(1);
    expect(said).toContain("Theo added Marie");
    expect(said).toContain("Theo added Sam");
    expect(said).toContain("Theo removed Marie");
  });

  it("lets somebody who joins on their own phone say so themselves", async () => {
    const { groupId } = await createGroup({
      name: "Siurek", baseCurrency: "EUR", myName: "Theo",
    });
    // The claim screen adds you before this phone speaks for anybody.
    await addMember(groupId, undefined, "Marie");

    expect((await described(groupId))[0]!.said).toBe("Marie joined the group");
  });

  // A rate is the group's, so its revisions land in the feed like any other —
  // and the entity id is the currency itself, which is what lets the sentence
  // name it without a lookup. Before this branch existed they read "renamed
  // the group".
  it("names the currency a rate revision is about", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Siurek", baseCurrency: "EUR", myName: "Theo",
    });
    const members = new Map<string, Member>(
      (await db().members.where("groupId").equals(groupId).toArray()).map((m) => [m.id, m]));
    const feed = async () => activityFeed(await opsForGroup(groupId))
      .filter((rev) => rev.entity === "rate")
      .map((rev) => describe(rev, "Theo", members, "EUR"));

    await setRate(groupId, theo, "MAD", "0.0921", "fetched", 0);
    const [set] = await feed();
    expect(set!.what).toBe("Theo set the MAD rate");
    expect(set!.diff).toEqual({ now: "1 MAD = 0.0921 EUR" });

    await setRate(groupId, theo, "MAD", "0.095", "typed", 0);
    const [changed] = await feed();
    expect(changed!.what).toBe("Theo changed the MAD rate");
    expect(changed!.diff).toEqual({ was: "1 MAD = 0.0921 EUR", now: "1 MAD = 0.095 EUR" });

    await clearRate(groupId, theo, "MAD");
    expect((await feed())[0]!.what).toBe("Theo removed the MAD rate");
  });

  it("describes every revision a whole group's life can produce", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { currency: "PLN", rateToBase: "1" });
    await editExpense(groupId, theo, expenseId, { rateToBase: "4.30" });
    await editExpense(groupId, theo, expenseId, { description: "Beers and chips" });
    await setRate(groupId, theo, "MAD", "0.0921", "fetched", 0);
    await clearRate(groupId, theo, "MAD");

    const all = await described(groupId);
    expect(all.length).toBeGreaterThan(4);
    for (const { said } of all) expect(said).not.toBe("");
  });
});
