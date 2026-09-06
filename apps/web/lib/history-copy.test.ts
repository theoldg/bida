import { beforeEach, describe as suite, expect, it } from "vitest";
import { activityFeed, type Member, type Revision } from "@hajsik/core";
import { db } from "./db/dexie";
import { opsForGroup } from "./db/fold";
import {
  addExpense, addMember, clearRate, createGroup, editExpense, healGroup,
  recordSettlement, removeMember, setRate,
} from "./db/commands";
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
async function described(
  groupId: string,
): Promise<{
  rev: Revision;
  said: string;
  diff?: { was?: string; now: string };
  also?: { label: string; was?: string; now?: string }[];
}[]> {
  const members = await db().members.where("groupId").equals(groupId).toArray();
  const byId = new Map<string, Member>(members.map((m) => [m.id, m]));
  const group = await db().groups.get(groupId);
  return activityFeed(await opsForGroup(groupId)).map((rev) => {
    const d = describe(rev, byId.get(rev.op.actor)?.name ?? "Someone", byId, group!.baseCurrency);
    return { rev, said: d.what, diff: d.diff, also: d.also };
  });
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

/** Theo and Marie, splitting one expense evenly — the shape a split edit needs. */
async function sharedExpense() {
  const { groupId, memberId: theo } = await createGroup({
    name: "Siurek", baseCurrency: "EUR", myName: "Theo",
  });
  const marie = await addMember(groupId, theo, "Marie");
  const expenseId = await addExpense(groupId, theo, {
    description: "Beers",
    occurredAt: Date.now(),
    amountMinor: 10_000,
    currency: "EUR",
    rateToBase: "1",
    paidBy: theo,
    split: { mode: "equal", members: [theo, marie] },
  });
  return { groupId, theo, marie, expenseId };
}

suite("describe", () => {
  beforeEach(wipe);

  // The bug these three exist for: every one of them used to read "Theo
  // changed who's involved" over the identical pair of names, twice.
  it("writes nothing at all when the same people are picked again", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    const before = (await described(groupId)).length;
    // What toggling somebody out and straight back in posts: the same two
    // people, the other way round.
    await editExpense(groupId, theo, expenseId, { split: { mode: "equal", members: [marie, theo] } });

    expect((await described(groupId)).length).toBe(before);
  });

  it("says whose share moved when the people did not", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    await editExpense(groupId, theo, expenseId, {
      split: { mode: "shares", weights: { [theo]: 2, [marie]: 1 } },
    });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo changed how it’s split");
    // Both lines carry a figure, which is the whole point — the old sentence
    // printed the same two names above and below.
    expect(latest!.diff!.was).toBe("Evenly");
    expect(latest!.diff!.now).toContain("Theo ×2");
    expect(latest!.diff!.now).toContain("Marie ×1");
  });

  it("keeps naming the people when they are the thing that changed", async () => {
    const { groupId, theo, expenseId } = await sharedExpense();
    await editExpense(groupId, theo, expenseId, { split: { mode: "equal", members: [theo] } });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo changed who’s involved");
    expect(latest!.diff!.was).toContain("Marie");
    expect(latest!.diff!.now).not.toContain("Marie");
  });

  it("stays quiet about a mode swapped for one that means the same", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    // One part each is evenly, written differently — so the edit that carries
    // it is the amount change and nothing else.
    await editExpense(groupId, theo, expenseId, {
      split: { mode: "shares", weights: { [theo]: 1, [marie]: 1 } },
      amountMinor: 12_500,
    });

    const [latest] = await described(groupId);
    expect(latest!.rev.changes.map((c) => c.field)).toContain("split");
    expect(latest!.said).toBe("Theo changed the amount");
  });

  // An entry is saved whole, so one revision routinely carries several changed
  // fields. Ranking them and printing the winner is how a permanent record came
  // to say the amount was €120 under an edit that had just put it back to €90 —
  // so where more than one moved, none of them gets the sentence.
  it("lists every field the same save changed, ranking none of them", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    const sam = await addMember(groupId, theo, "Sam");
    await editExpense(groupId, theo, expenseId, {
      split: { mode: "equal", members: [theo, marie, sam] },
      amountMinor: 12_000,
      description: "Beers and chips",
    });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo edited this entry");
    expect(latest!.diff).toBeUndefined();
    // The names are in the split's own order, which is the members' ids — so
    // the line is read for who is on it, and the rest for their exact values.
    const [involved, ...rest] = latest!.also!;
    expect(involved!.label).toBe("Who’s involved");
    expect(involved!.was).not.toContain("Sam");
    expect(involved!.now).toContain("Sam");
    expect(rest).toEqual([
      { label: "Amount", was: "€100.00", now: "€120.00" },
      { label: "Description", was: "Beers", now: "Beers and chips" },
    ]);
  });

  // The case history exists for: whose save put the figure back, and to what.
  it("never lets a reverted amount go unmentioned", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    await editExpense(groupId, marie, expenseId, { amountMinor: 12_000 });
    // What Marie's phone posts when it saves an entry it had not seen Theo's
    // amount for: the whole entity as she has it, reverting the figure.
    await editExpense(groupId, theo, expenseId, {
      amountMinor: 10_000,
      split: { mode: "equal", members: [theo] },
    });

    const [latest] = await described(groupId);
    expect(latest!.also).toContainEqual({ label: "Amount", was: "€120.00", now: "€100.00" });
  });

  it("leaves a revision that changed one field with its own sentence", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { description: "Beers and chips" });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo changed the description");
    expect(latest!.diff).toEqual({ was: "Beers", now: "Beers and chips" });
    expect(latest!.also).toBeUndefined();
  });

  // A crossing is the sentence a person reads that edit by — but only while it
  // is the whole of what the save did.
  it("puts a crossing into an income on a line with everything else it moved", async () => {
    const { groupId, theo, expenseId } = await expenseIn("EUR", "EUR");
    await editExpense(groupId, theo, expenseId, { kind: "income", amountMinor: 12_500 });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo edited this income");
    expect(latest!.also).toEqual([
      { label: "Kind", was: "Expense", now: "Income" },
      { label: "Amount", was: "€100.00", now: "€125.00" },
    ]);
  });

  it("prices an exact split in real money", async () => {
    const { groupId, theo, marie, expenseId } = await sharedExpense();
    await editExpense(groupId, theo, expenseId, {
      split: { mode: "exact", amounts: { [theo]: 7_000, [marie]: 3_000 } },
    });

    const [latest] = await described(groupId);
    expect(latest!.said).toBe("Theo changed how it’s split");
    expect(latest!.diff!.now).toContain("Marie €30.00");
  });

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

  // Nobody pressed anything for this line, so it names the reason rather than
  // the phone: a removal the log had already contradicted, undone.
  it("says why a member the group had removed is back", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Siurek", baseCurrency: "EUR", myName: "Theo",
    });
    const marie = await addMember(groupId, theo, "Marie");
    // The merge two offline phones produce: a transfer to Marie, and Marie
    // removed.
    await recordSettlement(groupId, theo, {
      fromMember: marie, toMember: theo, amountMinor: 3000,
      currency: "EUR", rateToBase: "1", occurredAt: 2,
    });
    await removeMember(groupId, theo, marie);

    await healGroup(groupId);

    expect((await described(groupId))[0]!.said)
      .toBe("Marie was removed, but an entry still names them — added back");
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
