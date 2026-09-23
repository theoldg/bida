import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64Url, type DevicePush } from "@bida/core";
import { db } from "./dexie";
import { addExpense, addMember, createGroup, deleteExpense, saveGroupKey } from "./commands";
import { appendOps } from "./commands/append";
import { groupState } from "./fold";
import { syncGroup } from "./sync";

/**
 * Sending (docs/notifications.md, step 6): a command keeps what it owes, and
 * the sync that lands its ops sends it to `/notify`, encrypted per device.
 * The server is mocked as ignorant as the real one — it sees ciphertext.
 */

async function wipe() {
  const d = db();
  await Promise.all([
    d.ops.clear(), d.groups.clear(), d.members.clear(), d.expenses.clear(), d.settlements.clear(),
    d.attachments.clear(), d.device.clear(), d.groupKeys.clear(), d.identities.clear(),
    d.rates.clear(), d.notices.clear(),
  ]);
}

/** A subscription a real browser could have made: a P-256 key and an auth secret. */
async function subscription(endpoint: string): Promise<DevicePush> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { endpoint, p256dh: toBase64Url(raw), auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Theo's group, with Bo listening from another phone. */
async function listeningGroup() {
  const { groupId, memberId: theo } = await createGroup({ name: "Trip", baseCurrency: "EUR", myName: "Theo" });
  await saveGroupKey(groupId, "shh");
  const bo = await addMember(groupId, theo, "Bo");
  const push = await subscription("https://fcm.googleapis.com/fcm/send/bo");
  await appendOps(groupId, bo, [{
    entity: "identity", entityId: "bo-phone", kind: "create", patch: { memberId: bo, claimedAt: 1, push },
  }]);
  return { groupId, theo, bo, push };
}

const dinner = (theo: string, bo: string) => ({
  description: "Dinner", occurredAt: 1, amountMinor: 4200, currency: "EUR", rateToBase: "1",
  paidBy: theo, split: { mode: "equal" as const, members: [theo, bo] },
});

interface Sent { endpoint: string; body: string }

/** The server: every op accepted, and each notification answered with `status`. */
function server(status: (endpoint: string) => number, opsOk = true) {
  const sent: Sent[][] = [];
  let seq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (url.endsWith("/notify")) {
      const batch = body.notifications as Sent[];
      sent.push(batch);
      return new Response(JSON.stringify({
        notified: Object.fromEntries(batch.map((n) => [n.endpoint, status(n.endpoint)])),
      }));
    }
    if (!opsOk) return new Response("down", { status: 503 });
    const assigned = Object.fromEntries((body.ops as { id: string }[]).map((op) => [op.id, ++seq]));
    return new Response(JSON.stringify({ assigned, ops: [], latestSeq: seq }));
  }));
  return sent;
}

describe("sending notices", () => {
  beforeEach(wipe);
  afterEach(() => vi.unstubAllGlobals());

  it("sends one encrypted notification per listening device once the ops land", async () => {
    const { groupId, theo, bo } = await listeningGroup();
    await addExpense(groupId, theo, dinner(theo, bo));
    expect(await db().notices.count()).toBe(1);

    const sent = server(() => 201);
    await syncGroup(groupId);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((n) => n.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/bo"]);
    // Ciphertext: the text never reaches the server readable.
    expect(atob(sent[0]![0]!.body)).not.toContain("Dinner");
    expect(await db().notices.count()).toBe(0);
  });

  it("keeps them while the ops are still on this phone", async () => {
    const { groupId, theo, bo } = await listeningGroup();
    await addExpense(groupId, theo, dinner(theo, bo));
    const sent = server(() => 201, false);
    await syncGroup(groupId).catch(() => {});
    expect(sent).toHaveLength(0);
    expect(await db().notices.count()).toBe(1);
  });

  it("clears a subscription its push service says is gone", async () => {
    const { groupId, theo, bo } = await listeningGroup();
    await addExpense(groupId, theo, dinner(theo, bo));
    server(() => 410);
    await syncGroup(groupId);
    const state = await groupState(groupId);
    expect(state.identities["bo-phone"]?.push).toBeNull();
    expect(await db().notices.count()).toBe(0);
  });

  it("keeps nothing when nobody else listens, or for what isn't news", async () => {
    const { groupId, memberId: theo } = await createGroup({ name: "Trip", baseCurrency: "EUR", myName: "Theo" });
    const bo = await addMember(groupId, theo, "Bo");
    const id = await addExpense(groupId, theo, dinner(theo, bo));
    expect(await db().notices.count()).toBe(0);

    const listening = await listeningGroup();
    // A member added is nobody's news, even to a listener.
    await addMember(listening.groupId, listening.theo, "Cy");
    expect(await db().notices.count()).toBe(0);
    // Nor is anything in a group nobody listens to.
    await deleteExpense(groupId, theo, id);
    expect(await db().notices.count()).toBe(0);
  });
});
