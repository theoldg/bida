import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foldOps } from "@hajsik/core";
import { db } from "./dexie";
import { addExpense, createGroup } from "./commands";
import { syncGroup } from "./sync";

/**
 * The sync engine's job is narrow: ship unsynced ops out, absorb whatever
 * comes back, and never lose or duplicate anything in the process. The wire
 * format itself (docs/sync.md) is exercised here against a mocked fetch —
 * the real server round-trip is apps/api's job.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(),
    d.settlements.clear(), d.attachments.clear(), d.device.clear(), d.groupKeys.clear(),
  ]);
}

describe("syncGroup", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing when this device holds no secret for the group", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncGroup("some-unknown-group");

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushes pending ops and marks them synced with the server's assigned seq", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    const pendingBefore = await db().ops.where("groupId").equals(groupId).toArray();
    expect(pendingBefore.every((op) => op.pending === 1)).toBe(true);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[]; since: number };
      expect(body.since).toBe(0);
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, i + 1]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: body.ops.length }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await syncGroup(groupId);

    expect(outcome).toEqual({ pushed: pendingBefore.length, pulled: 0 });
    const after = await db().ops.where("groupId").equals(groupId).toArray();
    expect(after.every((op) => op.pending === 0)).toBe(true);
    expect(after.every((op) => typeof op.seq === "number")).toBe(true);
    expect((await db().groupKeys.get(groupId))?.lastSeq).toBe(pendingBefore.length);
  });

  it("pulls remote ops and rebuilds so a second device folds to the same state", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await addExpense(groupId, theo, {
      description: "Riad", occurredAt: 1, amountMinor: 42000, currency: "EUR",
      rateToBase: "1", paidBy: theo, split: { mode: "equal", members: [theo] },
    });
    const remoteOps = (await db().ops.where("groupId").equals(groupId).toArray())
      .map(({ pending: _pending, ...op }) => ({ ...op, seq: 1 }));

    // Simulate a second device: same secret, nothing local yet.
    await wipe();
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: remoteOps, latestSeq: 1 }), { status: 200 }),
    ));

    const outcome = await syncGroup(groupId);

    expect(outcome).toEqual({ pushed: 0, pulled: remoteOps.length });
    const group = await db().groups.get(groupId);
    expect(group?.name).toBe("Marrakech");
    const expenses = await db().expenses.where("groupId").equals(groupId).toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.description).toBe("Riad");
    expect((await db().groupKeys.get(groupId))?.lastSeq).toBe(1);

    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    expect(foldOps(ops).group?.name).toBe("Marrakech");
  });

  it("surfaces a failed push instead of silently dropping ops", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));

    await expect(syncGroup(groupId)).rejects.toThrow();
    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    expect(ops.every((op) => op.pending === 1)).toBe(true);
  });
});
