import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveGroupCrypto, foldOps, openOp, sealOp, type Op, type SealedOp } from "@bida/core";
import { db } from "./dexie";
import { formatHlc, createHlcState } from "@bida/core";
import { addExpense, addMember, createGroup, forgetGroup, markEditsSeen, saveGroupKey } from "./commands";
import { getDevice } from "./device";
import { syncAll, syncGroup } from "./sync";
import { VERSION } from "../version";

/**
 * The sync engine: ship unsynced ops out, absorb what comes back, never lose
 * or duplicate. The wire format (docs/sync.md) runs against a mocked fetch;
 * the real round trip is apps/api's.
 *
 * The mock is as ignorant as the real server: sealed ops in, sealed ops out
 * (ADR-0036). `serverOps` is a peer's phone sealing what this one must open.
 */

/** What a peer pushed, as the server would hand it back: sealed, never plain. */
async function serverOps(groupId: string, ops: readonly Op[]): Promise<SealedOp[]> {
  const key = await db().groupKeys.get(groupId);
  const crypto = await deriveGroupCrypto(key!.secret, groupId);
  return Promise.all(ops.map((op) => sealOp(crypto, op)));
}

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

  it("sends a long queue in rounds, not as one request", async () => {
    const { groupId } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    const me = (await db().members.where("groupId").equals(groupId).toArray())[0]!;
    // A fortnight offline: more ops queued than one push is allowed to carry.
    for (let i = 0; i < 120; i++) {
      await addExpense(groupId, me.id, {
        description: `tagine ${i}`, occurredAt: 1, amountMinor: 1200, currency: "EUR",
        rateToBase: "1", paidBy: me.id,
        split: { mode: "equal", members: [me.id] },
      });
    }
    const queued = await db().ops.where("groupId").equals(groupId).toArray();
    expect(queued.length).toBeGreaterThan(100);

    const rounds: { ops: number; since: number }[] = [];
    let seq = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[]; since: number };
      rounds.push({ ops: body.ops.length, since: body.since });
      const assigned = Object.fromEntries(body.ops.map((op) => [op.id, ++seq]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: seq }));
    }));

    const outcome = await syncGroup(groupId);

    expect(outcome?.pushed).toBe(queued.length);
    expect(rounds.length).toBe(Math.ceil(queued.length / 50));
    expect(Math.max(...rounds.map((r) => r.ops))).toBeLessThanOrEqual(50);
    // Each round carries the cursor the one before it earned, so the second
    // request is not answered with everything the first already stored.
    expect(rounds[1]!.since).toBe(rounds[0]!.ops);
    // And the whole queue is through: nothing was dropped between rounds.
    const left = await db().ops.where("groupId").equals(groupId)
      .and((op) => op.pending === 1).toArray();
    expect(left).toHaveLength(0);
  });

  it("lands the rest of a pull that carries an op it cannot open", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });

    const peer = (seq: number, description: string) => ({
      id: `op-${seq}`, groupId, entity: "expense" as const, entityId: `e-${seq}`,
      kind: "create" as const,
      patch: {
        description, occurredAt: 1, amountMinor: 1000, currency: "EUR", rateToBase: "1",
        baseAmountMinor: 1000, paidBy: theo, split: { mode: "equal", members: [theo] },
      },
      hlc: formatHlc(createHlcState("peer", Date.now(), seq)),
      actor: theo, note: null, createdAt: Date.now(), seq,
    });
    const sealed = await serverOps(groupId, [peer(1, "Riad"), peer(3, "Tagine")]);
    // Between them, a row this build has no way to read — the shape the seal's
    // version byte takes the day it moves.
    const ops = [sealed[0]!, { id: "op-2", groupId, sealed: "AAAAAAAA", seq: 2 }, sealed[1]!];
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops, latestSeq: 3 })),
    ));

    const outcome = await syncGroup(groupId);

    expect(outcome?.pulled).toBe(2);
    const stored = await db().ops.where("groupId").equals(groupId).toArray();
    expect(stored.map((op) => op.id)).toEqual(expect.arrayContaining(["op-1", "op-3"]));
    expect(stored.find((op) => op.id === "op-2")).toBeUndefined();
    // Skipped, so the cursor moved past it — and written down, because the one
    // way back to it is winding `lastSeq` to `fromSeq - 1`.
    const key = await db().groupKeys.get(groupId);
    expect(key?.lastSeq).toBe(3);
    expect(key?.unreadable?.count).toBe(1);
    expect(key?.unreadable?.fromSeq).toBe(2);
    // And the group is usable: both readable expenses folded.
    expect(await db().expenses.where("groupId").equals(groupId).count()).toBe(2);
  });

  it("skips a stamp no clock could write instead of failing every sync after it", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });
    const expense = (seq: number, hlc: string) => ({
      id: `op-${seq}`, groupId, entity: "expense" as const, entityId: `e-${seq}`,
      kind: "create" as const,
      patch: {
        description: `e${seq}`, occurredAt: 1, amountMinor: 1000, currency: "EUR",
        rateToBase: "1", baseAmountMinor: 1000, paidBy: theo,
        split: { mode: "equal", members: [theo] },
      },
      hlc, actor: theo, note: null, createdAt: Date.now(), seq,
    });
    // The middle one overflows the counter inside the commit unless handled —
    // a rollback that would repeat on every retry, for every phone.
    const ops = await serverOps(groupId, [
      expense(1, formatHlc(createHlcState("peer", Date.now(), 0))),
      expense(2, "999999999999999-99999-evil"),
      expense(3, formatHlc(createHlcState("peer", Date.now(), 1))),
    ]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops, latestSeq: 3 })),
    ));

    const outcome = await syncGroup(groupId);

    expect(outcome?.pulled).toBe(2);
    expect((await db().groupKeys.get(groupId))?.unreadable).toMatchObject({ count: 1, fromSeq: 2 });
    // And the clock was not dragged to the end of time by it.
    expect((await getDevice()).hlcPhysical).toBeLessThan(10 ** 14);
  });

  it("holds back a stamp more than a day ahead, and takes it once the wall catches up", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });
    const start = Date.now();
    const twoDaysAhead = start + 2 * 24 * 3600_000;
    const ops = await serverOps(groupId, [{
      id: "op-1", groupId, entity: "expense", entityId: "e-1", kind: "create",
      patch: {
        description: "Riad", occurredAt: 1, amountMinor: 1000, currency: "EUR",
        rateToBase: "1", baseAmountMinor: 1000, paidBy: theo,
        split: { mode: "equal", members: [theo] },
      },
      hlc: formatHlc(createHlcState("fast", twoDaysAhead, 0)),
      actor: theo, note: null, createdAt: start, seq: 1,
    }]);
    const asked: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[]; since: number };
      asked.push(body.since);
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, 2 + i]));
      const latestSeq = 1 + body.ops.length;
      return new Response(JSON.stringify({ assigned, ops: body.since < 1 ? ops : [], latestSeq }));
    }));

    await syncGroup(groupId);
    // Not folded, and not adopted: this phone's clock is still its own.
    expect(await db().expenses.get("e-1")).toBeUndefined();
    expect((await getDevice()).hlcPhysical).toBeLessThan(start + 24 * 3600_000);
    const held = (await db().groupKeys.get(groupId))?.unreadable;
    expect(held).toMatchObject({ count: 1, fromSeq: 1, retryAt: twoDaysAhead - 24 * 3600_000 });

    // Before then, the cursor stays where it is.
    await syncGroup(groupId);
    expect(asked.at(-1)).toBeGreaterThanOrEqual(1);

    // Three days on, it is a day behind the wall: wound back for, and taken.
    vi.useFakeTimers({ toFake: ["Date"], now: start + 3 * 24 * 3600_000 });
    try {
      await syncGroup(groupId);
    } finally {
      vi.useRealTimers();
    }
    expect(asked.at(-1)).toBe(0);
    expect(await db().expenses.get("e-1")).toBeDefined();
    expect((await db().groupKeys.get(groupId))?.unreadable).toBeUndefined();
  });

  it("winds back to what it skipped, once, on a build that did not skip it", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({
      groupId, secret: "shh", lastSeq: 9,
      unreadable: { count: 1, fromSeq: 4, at: 1, build: "0.9.0" },
    });
    const late = await serverOps(groupId, [{
      id: "op-4", groupId, entity: "expense", entityId: "e-4", kind: "create",
      patch: {
        description: "Riad", occurredAt: 1, amountMinor: 1000, currency: "EUR",
        rateToBase: "1", baseAmountMinor: 1000, paidBy: theo,
        split: { mode: "equal", members: [theo] },
      },
      hlc: formatHlc(createHlcState("peer", Date.now(), 0)),
      actor: theo, note: null, createdAt: Date.now(), seq: 4,
    }]);
    const asked: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[]; since: number };
      asked.push(body.since);
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, 10 + i]));
      // Only the first ask reaches back far enough to get the op again.
      const ops = body.since < 4 ? late : [];
      return new Response(JSON.stringify({ assigned, ops, latestSeq: 9 + body.ops.length }));
    }));

    await syncGroup(groupId);
    // This build reads it: the expense lands, and the record of it goes.
    expect(asked[0]).toBe(3);
    expect(await db().expenses.get("e-4")).toBeDefined();
    const key = await db().groupKeys.get(groupId);
    expect(key?.unreadable).toBeUndefined();
    expect(key?.lastSeq).toBeGreaterThanOrEqual(9);

    // Nothing left to wind back to, so the next run asks from the cursor.
    await syncGroup(groupId);
    expect(asked.at(-1)).toBe(key?.lastSeq);
  });

  it("does not wind back again on the build that did the skipping", async () => {
    const { groupId } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({
      groupId, secret: "shh", lastSeq: 9,
      unreadable: { count: 1, fromSeq: 4, at: 1, build: VERSION },
    });
    const asked: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[]; since: number };
      asked.push(body.since);
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, 10 + i]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: 9 + body.ops.length }));
    }));

    await syncGroup(groupId);

    expect(asked[0]).toBe(9);
    expect((await db().groupKeys.get(groupId))?.unreadable?.fromSeq).toBe(4);
  });

  it("does nothing when this device holds no secret for the group", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncGroup("some-unknown-group");

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("holds a commit whose answer lands while the app is hidden until it is seen", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });

    // The phone goes to the background between asking and hearing back.
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", page);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[] };
      page.visibilityState = "hidden";
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, i + 1]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: body.ops.length }));
    }));

    let finished = false;
    const run = syncGroup(groupId).then(() => { finished = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(finished).toBe(false);
    const parked = await db().ops.where("groupId").equals(groupId).toArray();
    expect(parked.every((op) => op.pending === 1)).toBe(true);
    // And nothing new starts behind it while hidden.
    const fetches = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await syncAll();
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(fetches);

    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await run;
    const after = await db().ops.where("groupId").equals(groupId).toArray();
    expect(after.every((op) => op.pending === 0)).toBe(true);
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

  /**
   * The decision in docs/invariants.md: a phone whose member was removed puts
   * them back, unconditionally, signing as the person being restored. Forgetting
   * the group is the exit — the sync loop skips a forgotten group, so the
   * argument ends rather than running forever.
   */
  it("puts this phone's own member back when the merge removed them", async () => {
    const { groupId, memberId: marie } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Marie",
    });
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });

    // Somebody else's phone removed her, later on the clock than anything here.
    const removal = {
      id: "op-removal", groupId, entity: "member" as const, entityId: marie,
      kind: "update" as const, patch: { deletedAt: Date.now() },
      hlc: formatHlc(createHlcState("peer", Date.now() + 3600_000, 0)),
      actor: "someone-else", note: null, createdAt: Date.now(), seq: 1,
    };
    const sealed = await serverOps(groupId, [removal]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: sealed, latestSeq: 1 }), { status: 200 }),
    ));

    await syncGroup(groupId);

    expect((await db().members.get(marie))?.deletedAt).toBeNull();
    // Signed as the subject, and pending — the next run tells everyone else.
    const restore = (await db().ops.where("groupId").equals(groupId).toArray())
      .filter((op) => op.entityId === marie && op.kind === "update" && op.patch.deletedAt === null);
    expect(restore).toHaveLength(1);
    expect(restore[0]!.actor).toBe(marie);
    expect(restore[0]!.pending).toBe(1);
  });

  it("leaves somebody else's removal alone", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    const marie = await addMember(groupId, theo, "Marie");
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });

    const removal = {
      id: "op-removal", groupId, entity: "member" as const, entityId: marie,
      kind: "update" as const, patch: { deletedAt: Date.now() },
      hlc: formatHlc(createHlcState("peer", Date.now() + 3600_000, 0)),
      actor: theo, note: null, createdAt: Date.now(), seq: 1,
    };
    const sealed = await serverOps(groupId, [removal]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: sealed, latestSeq: 1 }), { status: 200 }),
    ));

    await syncGroup(groupId);

    expect((await db().members.get(marie))?.deletedAt).toBeTruthy();
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

    const sealed = await serverOps(groupId, remoteOps);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: sealed, latestSeq: 1 }), { status: 200 }),
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

  // Opening a group syncs it directly (app/g/page.tsx) rather than through
  // syncAll's guard, so it raced the loop's run for the same group: the same
  // ops pushed and pulled twice, and two rebuilds taking the readwrite lock on
  // every table while the screen was waiting to read them.
  it("joins a run already in flight for the same group", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 0 }), { status: 200 });
    }));

    const first = syncGroup(groupId);
    const second = syncGroup(groupId);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(calls).toBe(1);

    // And the group is free to sync again once that run is done.
    await syncGroup(groupId);
    expect(calls).toBe(2);
  });

  /**
   * The claim the about screen makes, at the one place it can be broken: what
   * leaves this phone. If a future change routes an op to the server without
   * going through `sealOp`, this is what notices.
   */
  it("sends a sealed body and a derived token, never the secret or the words in it", async () => {
    const { groupId } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({ groupId, secret: "shh-the-link-secret", lastSeq: 0 });
    let sent: { body: string; auth: string | null } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = {
        body: init.body as string,
        auth: new Headers(init.headers).get("Authorization"),
      };
      return new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 0 }), { status: 200 });
    }));

    await syncGroup(groupId);

    expect(sent).toBeDefined();
    // Probes are long on purpose: base64 has no space in its alphabet and 64
    // symbols in it, so a three-letter one like "EUR" turns up in a few hundred
    // random characters by chance — see the note in core's seal.test.ts. The
    // exact key set below is what actually pins the envelope down.
    for (const probe of ["Marrakech", "baseCurrency", "colorSeed", "claimedAt",
      "shh-the-link-secret"]) {
      expect(sent!.body).not.toContain(probe);
    }
    expect(sent!.auth).not.toContain("shh-the-link-secret");
    const pushed = (JSON.parse(sent!.body) as { ops: SealedOp[] }).ops;
    expect(pushed.length).toBeGreaterThan(0);
    expect(Object.keys(pushed[0]!).sort()).toEqual(["groupId", "id", "sealed", "seq"]);
    // And it is this group's ops — sealed, not mangled.
    const crypto = await deriveGroupCrypto("shh-the-link-secret", groupId);
    expect((await openOp(crypto, pushed[0]!)).groupId).toBe(groupId);
  });

  it("surfaces a failed push instead of silently dropping ops", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));

    await expect(syncGroup(groupId)).rejects.toThrow();
    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    expect(ops.every((op) => op.pending === 1)).toBe(true);
  });
});

/**
 * A phone whose changes go nowhere must not look up to date. These are the
 * record the banner reads — see lib/hooks.ts#useSyncHealth.
 */
describe("sync health", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("counts consecutive failures and keeps the status the server gave", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));

    await expect(syncGroup(groupId)).rejects.toThrow();
    expect((await db().groupKeys.get(groupId))?.failure).toMatchObject({ count: 1, status: 403 });

    await expect(syncGroup(groupId)).rejects.toThrow();
    expect((await db().groupKeys.get(groupId))?.failure).toMatchObject({ count: 2, status: 403 });
  });

  it("records no status when the request never reached the server", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    await expect(syncGroup(groupId)).rejects.toThrow();
    const failure = (await db().groupKeys.get(groupId))?.failure;
    expect(failure?.count).toBe(1);
    expect(failure?.status).toBeUndefined();
  });

  it("clears the failure and stamps the time once a sync gets through", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(syncGroup(groupId)).rejects.toThrow();
    expect((await db().groupKeys.get(groupId))?.failure?.count).toBe(1);

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[] };
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, i + 1]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: body.ops.length }), { status: 200 });
    }));

    await syncGroup(groupId);

    const key = await db().groupKeys.get(groupId);
    expect(key?.failure).toBeUndefined();
    expect(key?.lastSyncedAt).toBeGreaterThan(0);
  });

  it("keeps the sync cursor and clears the failure when a fresh link is opened", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(syncGroup(groupId)).rejects.toThrow();
    await db().groupKeys.update(groupId, { lastSeq: 7, lastSyncedAt: 1234 });

    await saveGroupKey(groupId, "a-new-secret");

    const key = await db().groupKeys.get(groupId);
    expect(key?.secret).toBe("a-new-secret");
    expect(key?.failure).toBeUndefined();
    expect(key?.lastSeq).toBe(7);
    expect(key?.lastSyncedAt).toBe(1234);
  });

  // The point of an HLC: having *seen* a peer's op makes this device stamp
  // after it. By wall clock alone a peer three hours fast wins every conflict,
  // and a reply to their op sorts before it.
  it("adopts the clock of every op it pulls, so a reply sorts after it", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    const before = await getDevice();
    const fromTheFuture = formatHlc(createHlcState("peer", Date.now() + 3 * 3600_000, 0));
    const remote: Op = {
      id: "op-from-a-fast-phone", groupId, entity: "group", entityId: groupId,
      kind: "update", patch: { name: "Marrakesh" }, hlc: fromTheFuture,
      actor: "someone", note: null, createdAt: Date.now(), seq: 1,
    };

    const sealed = await serverOps(groupId, [remote]);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[] };
      const assigned = Object.fromEntries(body.ops.map((op, i) => [op.id, i + 1]));
      return new Response(JSON.stringify({ assigned, ops: sealed, latestSeq: 1 }), { status: 200 });
    }));

    await syncGroup(groupId);

    const after = await getDevice();
    expect(before.hlcPhysical).toBeLessThan(after.hlcPhysical);
    // Not merely "moved": far enough that the next local op outranks theirs.
    await addExpense(groupId, "theo", {
      description: "Riad", occurredAt: 1, amountMinor: 100, currency: "EUR",
      rateToBase: "1", paidBy: "theo", split: { mode: "equal", members: ["theo"] },
    });
    const mine = (await db().ops.where("groupId").equals(groupId).toArray())
      .filter((op) => op.pending === 1);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((op) => op.hlc > fromTheFuture)).toBe(true);
  });
});

describe("syncAll", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("leaves a forgotten group alone", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    await forgetGroup(groupId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await syncAll();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("picks a forgotten group back up once its invite link is opened again", async () => {
    const { groupId } = await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    await forgetGroup(groupId);
    await saveGroupKey(groupId, "shh");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncAll();

    expect(fetchMock).toHaveBeenCalled();
  });

  // Five things trigger syncAll. An overlapping call must join the run in
  // flight — attempting nothing and reporting "no failures" would reset the
  // backoff and retry a dead server every two seconds.
  it("joins the run already in flight rather than starting a second one", async () => {
    await createGroup({ name: "Marrakech", baseCurrency: "EUR", myName: "Theo" });
    let inFlight = 0;
    let overlapped = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({ assigned: {}, ops: [], latestSeq: 0 }), { status: 200 });
    }));

    const first = syncAll();
    const second = syncAll();
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(overlapped).toBe(false);
  });
});

describe("seenSeq", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("starts at the first pull's cursor, stays behind later ones, and only moves forward", async () => {
    const { groupId, memberId: theo } = await createGroup({
      name: "Marrakech", baseCurrency: "EUR", myName: "Theo",
    });
    await db().groupKeys.put({ groupId, secret: "shh", lastSeq: 0 });
    const peer = (seq: number) => ({
      id: `op-${seq}`, groupId, entity: "expense" as const, entityId: `e-${seq}`,
      kind: "create" as const,
      patch: {
        description: `e${seq}`, occurredAt: 1, amountMinor: 1000, currency: "EUR", rateToBase: "1",
        baseAmountMinor: 1000, paidBy: theo, split: { mode: "equal", members: [theo] },
      },
      hlc: formatHlc(createHlcState("peer", Date.now(), seq)),
      actor: theo, note: null, createdAt: Date.now(), seq,
    });
    let batch: Op[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const { ops: pushed } = JSON.parse(init.body as string) as { ops: { id: string }[] };
      const assigned = Object.fromEntries(pushed.map((op, i) => [op.id, 100 + i]));
      const ops = await serverOps(groupId, batch);
      return new Response(JSON.stringify({ assigned, ops, latestSeq: Math.max(0, ...batch.map((o) => o.seq!)) }));
    }));

    // Joining: everything the first pull brings is the group's past.
    batch = [peer(1), peer(2)];
    await syncGroup(groupId);
    expect((await db().groupKeys.get(groupId))?.seenSeq).toBe(2);

    // After that, a pull is news until something shows it.
    batch = [peer(3)];
    await syncGroup(groupId);
    expect((await db().groupKeys.get(groupId))?.seenSeq).toBe(2);

    await markEditsSeen(groupId, 3);
    await markEditsSeen(groupId, 1);
    expect((await db().groupKeys.get(groupId))?.seenSeq).toBe(3);
  });
});
