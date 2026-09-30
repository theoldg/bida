import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHlcState, deriveGroupCrypto, formatHlc, sealOp, type Op } from "@bida/core";
import { db } from "./dexie";
import { createGroup } from "./commands";
import { eraseGroupLocally } from "./commands/groups";
import { getDevice } from "./device";
import { applyStash, syncGroup } from "./sync";

/**
 * The pull ahead (docs/sync.md#the-pull-ahead): `public/sw.js` leaves a pull in
 * Cache Storage, and the page applies it before drawing the group. What these
 * pin is the promise that makes it safe — **a stash only ever adds ops**, and
 * never moves the cursor the ordinary pull starts from. The worker's half is
 * in lib/sw.test.ts.
 */

/** Cache Storage as the page sees it: one cache is all this uses. */
function stubCaches(): Map<string, string> {
  const entries = new Map<string, string>();
  const cache = {
    async match(key: string) {
      const body = entries.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    async put(key: string, res: Response) { entries.set(key, await res.text()); },
    async delete(key: string) { return entries.delete(key); },
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return entries;
}

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(), d.groupKeys.clear(),
  ]);
}

async function heldGroup() {
  const { groupId, memberId } = await createGroup({
    name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
  });
  await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 4 });
  return { groupId, theo: memberId };
}

function peerExpense(groupId: string, theo: string, seq: number, description: string): Op {
  return {
    id: `op-${seq}`, groupId, entity: "expense", entityId: `e-${seq}`, kind: "create",
    patch: {
      description, occurredAt: 1, amountMinor: 1000, currency: "EUR", rateToBase: "1",
      baseAmountMinor: 1000, paidBy: theo, split: { mode: "equal", members: [theo] },
    },
    // Ahead of this phone's clock, so adopting the stamp is visible.
    hlc: formatHlc(createHlcState("peer", Date.now() + 60_000, seq)),
    actor: theo, note: null, createdAt: Date.now(), seq,
  };
}

/** What the worker leaves: the server's answer, sealed. */
async function stash(entries: Map<string, string>, groupId: string, ops: Op[]) {
  const crypto = await deriveGroupCrypto("shh", groupId);
  const sealed = await Promise.all(ops.map((op) => sealOp(crypto, op)));
  entries.set(`/pull/${encodeURIComponent(groupId)}/ops`,
    JSON.stringify({ assigned: {}, ops: sealed, latestSeq: 6 }));
}

describe("applying what the worker pulled ahead", () => {
  let entries: Map<string, string>;
  beforeEach(async () => { await wipe(); entries = stubCaches(); });
  afterEach(() => vi.unstubAllGlobals());

  it("stores and folds the ops, adopts their stamps, and leaves the cursor alone", async () => {
    const { groupId, theo } = await heldGroup();
    const ops = [peerExpense(groupId, theo, 5, "Riad"), peerExpense(groupId, theo, 6, "Tagine")];
    await stash(entries, groupId, ops);

    await applyStash(groupId);

    expect(await db().expenses.where("groupId").equals(groupId).count()).toBe(2);
    expect((await getDevice()).hlcPhysical).toBeGreaterThan(Date.now());
    expect((await db().groupKeys.get(groupId))?.lastSeq).toBe(4);
    expect(entries.has(`/pull/${groupId}/ops`)).toBe(false);

    // So the ordinary pull still asks from where it always would: nothing the
    // stash lacked can be skipped.
    const asked: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      asked.push((JSON.parse(init.body as string) as { since: number }).since);
      return new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 6 }));
    }));
    await syncGroup(groupId);
    expect(asked[0]).toBe(4);
  });

  it("writes nothing for ops the phone already holds", async () => {
    const { groupId, theo } = await heldGroup();
    const ops = [peerExpense(groupId, theo, 5, "Riad")];
    await stash(entries, groupId, ops);
    await applyStash(groupId);
    const before = await getDevice();

    await stash(entries, groupId, ops);
    await applyStash(groupId);

    expect(await getDevice()).toEqual(before);
    expect(await db().expenses.where("groupId").equals(groupId).count()).toBe(1);
  });

  it("puts back nothing of a group no longer on the phone", async () => {
    const { groupId, theo } = await heldGroup();
    await stash(entries, groupId, [peerExpense(groupId, theo, 5, "Riad")]);
    await db().groupKeys.delete(groupId);

    await applyStash(groupId);

    expect(await db().ops.get("op-5")).toBeUndefined();
    expect(entries.size).toBe(0);
  });

  it("never fails the screen waiting on it", async () => {
    const { groupId } = await heldGroup();
    entries.set(`/pull/${groupId}/ops`, "not json");
    await expect(applyStash(groupId)).resolves.toBeUndefined();
  });
});

describe("the cursor the worker pulls with", () => {
  let entries: Map<string, string>;
  beforeEach(async () => { await wipe(); entries = stubCaches(); });
  afterEach(() => vi.unstubAllGlobals());

  it("is left by a sync: the bearer and the seq it reached, never the secret", async () => {
    const { groupId } = await heldGroup();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 9 })),
    ));

    await syncGroup(groupId);

    const cursor = JSON.parse(entries.get(`/pull/${groupId}/cursor`)!) as Record<string, unknown>;
    const { token } = await deriveGroupCrypto("shh", groupId);
    expect(cursor).toEqual({ token, since: 9 });
  });

  it("goes with the group", async () => {
    const { groupId, theo } = await heldGroup();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 4 })),
    ));
    await syncGroup(groupId);
    await stash(entries, groupId, [peerExpense(groupId, theo, 5, "Riad")]);

    await eraseGroupLocally(groupId);

    expect(entries.size).toBe(0);
  });
});
