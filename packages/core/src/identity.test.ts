import { describe, expect, it } from "vitest";
import { foldOps } from "./fold.js";
import { activityFeed, entityHistory } from "./history.js";
import { validateOp, type Op } from "./ops.js";
import { createHlcState, formatHlc } from "./hlc.js";
import { GROUP, MARIE, SAM } from "./fixtures.test-helper.js";

/**
 * Identity claims are ops (ADR-0003), keyed by the device's HLC node id — the
 * string ending every op that device stamped.
 */

const PHONE = "sams1phone";

function claim(
  ms: number,
  kind: Op["kind"],
  memberId: string,
  actor: string,
  node = PHONE,
): Op {
  return validateOp({
    id: `id-${node}-${ms}`,
    groupId: GROUP,
    entity: "identity",
    entityId: node,
    kind,
    patch: { memberId, claimedAt: ms },
    hlc: formatHlc(createHlcState("aaa", ms, 0)),
    actor,
    createdAt: ms,
  });
}

describe("identity ops", () => {
  it("folds into one row per device, keyed by node id", () => {
    const state = foldOps([
      claim(1000, "create", SAM, SAM),
      claim(2000, "update", MARIE, SAM),
      claim(1500, "create", MARIE, MARIE, "marieph0ne"),
    ]);

    expect(Object.keys(state.identities).sort()).toEqual(["marieph0ne", PHONE]);
    expect(state.identities[PHONE]).toEqual({
      id: PHONE,
      groupId: GROUP,
      memberId: MARIE,
      claimedAt: 2000,
    });
    expect(state.identities["marieph0ne"]?.memberId).toBe(MARIE);
  });

  it("last claim wins by HLC, not by arrival order", () => {
    const ops = [claim(2000, "update", MARIE, SAM), claim(1000, "create", SAM, SAM)];
    expect(foldOps(ops).identities[PHONE]?.memberId).toBe(MARIE);
    expect(foldOps([...ops].reverse()).identities[PHONE]?.memberId).toBe(MARIE);
  });

  it("keeps identities out of the entities that carry money", () => {
    const state = foldOps([claim(1000, "create", SAM, SAM)]);
    expect(state.members).toEqual({});
    expect(state.expenses).toEqual({});
    expect(state.settlements).toEqual({});
  });

  it("reads back as a switch, with the member who made it as the actor", () => {
    const ops = [claim(1000, "create", SAM, SAM), claim(2000, "update", MARIE, SAM)];
    const revisions = entityHistory(ops, PHONE);

    expect(revisions).toHaveLength(2);
    expect(revisions[0]!.op.actor).toBe(SAM);
    expect(revisions[0]!.changes.find((c) => c.field === "memberId")).toMatchObject({
      before: SAM,
      after: MARIE,
    });
    expect(revisions[1]!.isCreate).toBe(true);
  });

  it("appears in the group's activity feed beside everything else", () => {
    const feed = activityFeed([claim(1000, "create", SAM, SAM)]);
    expect(feed.map((r) => r.entity)).toEqual(["identity"]);
  });

  describe("push", () => {
    const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "BP", auth: "au" };
    const subscribe = (ms: number, push: typeof SUB | null, node = PHONE): Op =>
      validateOp({
        id: `push-${node}-${ms}`,
        groupId: GROUP,
        entity: "identity",
        entityId: node,
        kind: "update",
        patch: { push },
        hlc: formatHlc(createHlcState("aaa", ms, 0)),
        actor: SAM,
        createdAt: ms,
      });

    it("merges independently of the claim, whichever lands first", () => {
      // A subscription written before a switch of member, stamped earlier or later.
      const ops = [claim(1000, "create", SAM, SAM), subscribe(3000, SUB), claim(2000, "update", MARIE, SAM)];
      for (const order of [ops, [...ops].reverse(), [ops[1]!, ops[0]!, ops[2]!]]) {
        expect(foldOps(order).identities[PHONE]).toMatchObject({ memberId: MARIE, push: SUB });
      }
      const later = [...ops, claim(4000, "update", SAM, MARIE)];
      expect(foldOps(later).identities[PHONE]).toMatchObject({ memberId: SAM, push: SUB });
    });

    it("clears with null", () => {
      const state = foldOps([claim(1000, "create", SAM, SAM), subscribe(2000, SUB), subscribe(3000, null)]);
      expect(state.identities[PHONE]?.push).toBeNull();
    });

    it("is not history: a revision that moved only push is dropped", () => {
      const ops = [claim(1000, "create", SAM, SAM), subscribe(2000, SUB), subscribe(3000, null)];
      expect(entityHistory(ops, PHONE)).toHaveLength(1);
      expect(activityFeed(ops)).toHaveLength(1);
    });
  });
});
