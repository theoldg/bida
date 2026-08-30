import { describe, expect, it } from "vitest";
import { foldOps } from "./fold.js";
import { activityFeed, entityHistory } from "./history.js";
import { validateOp, type Op } from "./ops.js";
import { createHlcState, formatHlc } from "./hlc.js";
import { GROUP, MARIE, SAM } from "./fixtures.test-helper.js";

/**
 * Identity claims are ops like everything else (ADR-0003): a device says which
 * member it speaks for, and the group can read it. The device's HLC node id is
 * the entity id, so the claim is keyed by the same string that already ends
 * every op that device stamped.
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
});
