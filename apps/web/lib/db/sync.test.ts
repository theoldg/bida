import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveGroupCrypto, foldOps, openOp, sealOp, type Op, type SealedOp } from "@bida/core";
import { db } from "./dexie";
import { formatHlc, createHlcState } from "@bida/core";
import { addExpense, addMember, createGroup, forgetGroup, saveGroupKey } from "./commands";
import { getDevice } from "./device";
import { syncAll, syncGroup } from "./sync";

/**
 * The sync engine's job is narrow: ship unsynced ops out, absorb whatever
 * comes back, and never lose or duplicate anything in the process. The wire
 * format itself (docs/sync.md) is exercised here against a mocked fetch —
 * the real server round-trip is apps/api's job.
 *
 * The mocked server is held to the real one's ignorance: it is handed sealed
 * ops and it answers with sealed ops, because that is all the real one has
 * (ADR-0036). `serverOps` is the seam — a peer's phone sealing what this one
 * will have to open.
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
 * A phone whose changes are going nowhere used to look exactly like one that
 * was up to date. These are the record the banner reads — see
 * lib/hooks.ts#useSyncHealth.
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

  // The whole point of an HLC: having *seen* a peer's op is what makes this
  // device stamp after it. Ordering by wall clock alone let a peer three hours
  // fast win every conflict, and the correction you typed in reply to their
  // op sorted before it and was folded away.
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

  // Five things trigger syncAll. An overlapping call used to attempt nothing,
  // conclude "no failures", and reset the backoff the failing run had just
  // grown — so a dead server was retried every two seconds forever.
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
