import { describe, expect, it } from "vitest";
import { DEMO_GROUP_ID, type DevicePush, type Identity } from "@bida/core";
import { notifyLevel, pushAt, pushFromSubscription, pushStateFrom, pushWrites } from "./push";

/** The subscription's decisions (lib/push.ts): when to offer, and which identities to write. */

const SUB: DevicePush = { endpoint: "https://fcm.googleapis.com/fcm/send/a", p256dh: "BPk", auth: "au" };
const NODE = "node-1";

const identity = (groupId: string, push?: DevicePush | null): Identity => ({
  id: NODE, groupId, memberId: `m-${groupId}`, claimedAt: 1, ...(push === undefined ? {} : { push }),
});

describe("pushStateFrom", () => {
  it("offers only while the question is unasked", () => {
    expect(pushStateFrom({ supported: true, permission: "default" })).toBe("ask");
    expect(pushStateFrom({ supported: true, permission: "granted" })).toBe("on");
    // Denied can't be asked again; the card would be a button that does nothing.
    expect(pushStateFrom({ supported: true, permission: "denied" })).toBe("denied");
  });

  it("offers nothing where push isn't — a Safari tab, an old browser", () => {
    expect(pushStateFrom({ supported: false, permission: "default" })).toBe("unsupported");
    expect(pushStateFrom({ supported: true, permission: undefined })).toBe("unsupported");
  });
});

describe("pushFromSubscription", () => {
  it("keeps the endpoint and both keys, and nothing else", () => {
    expect(pushFromSubscription({
      endpoint: SUB.endpoint, expirationTime: null, keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    })).toEqual(SUB);
  });

  it("refuses a subscription missing a key rather than write half of one", () => {
    expect(pushFromSubscription({ endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh } })).toBeNull();
    expect(pushFromSubscription({ keys: { p256dh: SUB.p256dh, auth: SUB.auth } })).toBeNull();
  });
});

describe("pushWrites", () => {
  const base = { held: ["g1", "g2"], left: [] as string[] };

  it("writes a new subscription to every held, claimed group that lacks it", () => {
    const writes = pushWrites({ ...base, identities: [identity("g1"), identity("g2", null)], want: SUB });
    expect(writes.map((i) => i.groupId)).toEqual(["g1", "g2"]);
  });

  it("writes nothing when the log already says it", () => {
    expect(pushWrites({ ...base, identities: [identity("g1", { ...SUB })], want: SUB })).toEqual([]);
  });

  // Safari rotates without saying: a new endpoint or key is a write.
  it("writes a rotated subscription over the old one", () => {
    const old = { ...SUB, endpoint: "https://web.push.apple.com/old" };
    expect(pushWrites({ ...base, identities: [identity("g1", old)], want: SUB })).toHaveLength(1);
    expect(pushWrites({ ...base, identities: [identity("g1", { ...SUB, auth: "x" })], want: SUB }))
      .toHaveLength(1);
  });

  it("clears a subscription with null, but leaves a phone that never had one alone", () => {
    expect(pushWrites({ ...base, identities: [identity("g1", SUB)], want: null })).toHaveLength(1);
    expect(pushWrites({ ...base, identities: [identity("g1"), identity("g2", null)], want: null }))
      .toEqual([]);
  });

  // Settings' level rides on the subscription: a changed scope is a write,
  // and an absent one is "own", so the subscriptions written before agree.
  it("writes a changed scope, and reads an absent one as own", () => {
    expect(pushWrites({ ...base, identities: [identity("g1", SUB)], want: { ...SUB, scope: "all" } }))
      .toHaveLength(1);
    expect(pushWrites({ ...base, identities: [identity("g1", { ...SUB, scope: "all" })], want: SUB }))
      .toHaveLength(1);
    expect(pushWrites({ ...base, identities: [identity("g1", { ...SUB, scope: "own" })], want: SUB }))
      .toEqual([]);
  });

  it("skips a group left, a group not held, and the demo", () => {
    const identities = [identity("g1"), identity("g3"), identity(DEMO_GROUP_ID)];
    expect(pushWrites({ held: ["g1", "g3", DEMO_GROUP_ID], left: ["g1"], identities, want: SUB })
      .map((i) => i.groupId)).toEqual(["g3"]);
    expect(pushWrites({ held: [], left: [], identities, want: SUB })).toEqual([]);
  });
});

describe("pushAt", () => {
  const json = { endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } };

  it("leaves scope out for just me, so nothing written before the choice moves", () => {
    expect(pushAt(json, "own")).toEqual(SUB);
  });

  it("says all, and off is no subscription on the log at all", () => {
    expect(pushAt(json, "all")).toEqual({ ...SUB, scope: "all" });
    expect(pushAt(json, "off")).toBeNull();
    expect(pushAt(null, "all")).toBeNull();
  });
});

describe("notifyLevel", () => {
  it("is off without permission whatever was chosen, and just me when nothing was", () => {
    expect(notifyLevel("ask", "all")).toBe("off");
    expect(notifyLevel("denied", undefined)).toBe("off");
    expect(notifyLevel("on", undefined)).toBe("own");
    expect(notifyLevel("on", "off")).toBe("off");
    expect(notifyLevel("on", "all")).toBe("all");
  });
});
