import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveGroupCrypto, entityHistory, fromBase64, openPhoto, sealPhoto, toBase64 } from "@bida/core";
import { db } from "./dexie";
import { addExpense, createGroup, editExpense, forgetGroup, type ExpenseInput } from "./commands";
import { fetchPhoto, syncGroup } from "./sync";
import { keptJpeg } from "./photos";

/**
 * A kept photo (docs/photos.md): the save writes the attachment beside the
 * entry, the bytes wait on this phone until the server has them, and what a
 * rescan or an untick gives up is asked of the server to drop.
 */

const JPEG = toBase64(new Uint8Array(3000).map((_, i) => (i * 13) % 256));
const OTHER = toBase64(new Uint8Array(2000).map((_, i) => (i * 7) % 256));
const P1 = "0b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";
const P2 = "1b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d";

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(), d.settlements.clear(),
    d.attachments.clear(), d.device.clear(), d.groupKeys.clear(), d.photos.clear(),
  ]);
}

async function dinner() {
  const { groupId, memberId: me } = await createGroup({ name: "Lisbon", baseCurrency: "EUR", myName: "Theo" });
  const input: ExpenseInput = {
    description: "Bacalhau", occurredAt: 1, amountMinor: 4200, currency: "EUR", rateToBase: "1",
    paidBy: me, split: { mode: "equal", members: [me] },
  };
  return { groupId, me, input };
}

const keep = (id: string, jpeg = JPEG) => ({ keep: { id, jpeg, bytes: fromBase64(jpeg)!.length } });

/** A server that stores ops and photos the way the Worker does: sealed, unread. */
function server(answer: (method: string, url: string) => Response | undefined = () => undefined) {
  const photos = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let seq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const photo = /\/photos\/([^/]+)$/.exec(url)?.[1];
    if (photo) calls.push(`${method} ${photo}`);
    const forced = answer(method, url);
    if (forced) return forced;
    if (!photo) {
      const body = JSON.parse(init.body as string) as { ops: { id: string }[] };
      const assigned = Object.fromEntries(body.ops.map((op) => [op.id, ++seq]));
      return new Response(JSON.stringify({ assigned, ops: [], latestSeq: seq }));
    }
    if (method === "PUT") photos.set(photo, new Uint8Array(await (init.body as Blob).arrayBuffer()));
    if (method === "DELETE") photos.delete(photo);
    if (method === "GET") {
      const held = photos.get(photo);
      return held ? new Response(held as BlobPart) : new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify({ stored: true }));
  }));
  return { photos, calls };
}

describe("saving a kept photo", () => {
  beforeEach(wipe);

  it("writes the attachment with the entry and holds the bytes for upload", async () => {
    const { groupId, me, input } = await dinner();
    const id = await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    expect((await db().expenses.get(id))?.attachmentIds).toEqual([P1]);
    expect(await db().attachments.get(P1)).toMatchObject({ expenseId: id, mime: "image/jpeg", bytes: 3000 });
    expect(await db().photos.get(P1)).toMatchObject({ groupId, jpeg: JPEG, state: "upload" });
    // The entry says it gained a photo; the attachment says nothing of its own.
    const ops = await db().ops.where("groupId").equals(groupId).toArray();
    expect(entityHistory(ops, P1)).toEqual([]);
  });

  it("replaces the kept photo on a rescan, and queues the old one to drop", async () => {
    const { groupId, me, input } = await dinner();
    const id = await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    await editExpense(groupId, me, id, {}, keep(P2, OTHER));
    expect((await db().expenses.get(id))?.attachmentIds).toEqual([P2]);
    expect((await db().attachments.get(P1))?.deletedAt).toBeTypeOf("number");
    expect(await db().photos.get(P1)).toEqual({ id: P1, groupId, state: "delete" });
    expect((await db().photos.get(P2))?.state).toBe("upload");
  });

  it("keeps none once unticked, and leaves it alone when nobody asked", async () => {
    const { groupId, me, input } = await dinner();
    const id = await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    await editExpense(groupId, me, id, { description: "Bacalhau à Brás" });
    expect((await db().expenses.get(id))?.attachmentIds).toEqual([P1]);
    await editExpense(groupId, me, id, {}, { drop: true });
    expect((await db().expenses.get(id))?.attachmentIds ?? null).toBeNull();
    expect((await db().photos.get(P1))?.state).toBe("delete");
  });

  it("writes no revision for a drop when nothing was kept", async () => {
    const { groupId, me, input } = await dinner();
    const id = await addExpense(groupId, me, input);
    const before = await db().ops.count();
    await editExpense(groupId, me, id, {}, { drop: true });
    expect(await db().ops.count()).toBe(before);
  });

  it("goes with the group when this phone forgets it", async () => {
    const { groupId, me, input } = await dinner();
    await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    await forgetGroup(groupId);
    // Forgetting waits on the queue; the photo is dropped with the rest.
    server();
    await syncGroup(groupId);
    expect(await db().photos.count()).toBe(0);
  });
});

describe("syncing kept photos", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("uploads sealed, after the ops, and marks it held", async () => {
    const { groupId, me, input } = await dinner();
    await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    const { photos, calls } = server();
    await syncGroup(groupId);
    expect(calls).toEqual([`PUT ${P1}`]);
    const sealed = photos.get(P1)!;
    const crypto = await deriveGroupCrypto((await db().groupKeys.get(groupId))!.secret, groupId);
    expect(toBase64(await openPhoto(crypto, groupId, P1, sealed))).toBe(JPEG);
    expect((await db().photos.get(P1))?.state).toBe("held");
  });

  it("waits hours after a full bucket, and doesn't ask again before then", async () => {
    const { groupId, me, input } = await dinner();
    await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    const { calls } = server((method) =>
      (method === "PUT" ? new Response(JSON.stringify({ scope: "storage" }), { status: 507 }) : undefined));
    await syncGroup(groupId);
    const row = await db().photos.get(P1);
    expect(row?.state).toBe("upload");
    expect(row?.retryAt).toBeGreaterThan(Date.now() + 60 * 60_000);
    await syncGroup(groupId);
    expect(calls).toEqual([`PUT ${P1}`]);
  });

  it("asks the server to drop a replaced photo, and forgets it once done", async () => {
    const { groupId, me, input } = await dinner();
    const id = await addExpense(groupId, me, input, Date.now(), undefined, keep(P1));
    const { photos, calls } = server();
    await syncGroup(groupId);
    await editExpense(groupId, me, id, {}, keep(P2, OTHER));
    await syncGroup(groupId);
    expect(calls).toEqual([`PUT ${P1}`, `PUT ${P2}`, `DELETE ${P1}`]);
    expect([...photos.keys()]).toEqual([P2]);
    expect(await db().photos.get(P1)).toBeUndefined();
  });

  it("fetches another phone's photo once, opens it and keeps it", async () => {
    const { groupId } = await dinner();
    const { photos, calls } = server();
    const crypto = await deriveGroupCrypto((await db().groupKeys.get(groupId))!.secret, groupId);
    photos.set(P1, await sealPhoto(crypto, groupId, P1, fromBase64(JPEG)!));
    await Promise.all([fetchPhoto(groupId, P1), fetchPhoto(groupId, P1)]);
    expect(calls).toEqual([`GET ${P1}`]);
    expect(await db().photos.get(P1)).toEqual({ id: P1, groupId, jpeg: JPEG, state: "held" });
  });

  it("asks nothing for a group with no key, like the demo", async () => {
    const { calls } = server();
    await fetchPhoto("no-such-group", P1);
    expect(calls).toEqual([]);
  });
});

describe("keptJpeg", () => {
  it("takes the scan's data URL to the bytes it decodes to", () => {
    for (const n of [3000, 3001, 3002]) {
      const jpeg = toBase64(new Uint8Array(n));
      expect(keptJpeg(`data:image/jpeg;base64,${jpeg}`)).toEqual({ jpeg, bytes: n });
    }
  });
});
