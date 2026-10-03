import {
  colorSeedFor, healDrafts, isDemo, memberIdFor, newGroupId, newGroupSecret, restoreClaimDrafts,
  type CurrencyCode, type Id,
} from "@bida/core";
import { db } from "../dexie";
import { groupState } from "../fold";
import { getDevice, getMe, hideGroup, setMe, unhideGroup, updateDevice } from "../device";
import { requestPersistence } from "../../persist";
import { reconcilePush } from "../../push";
import { forgetShown } from "../../roll";
import type { CarriedGroup } from "../../group-link";
import { appendOps } from "./append";
import { dropStash } from "../stash";

/** The name is the id (core/names.ts): two phones adding "Ana" offline write one member. */
const memberCreate = (groupId: Id, name: string) => ({
  entity: "member" as const,
  entityId: memberIdFor(groupId, name),
  kind: "create" as const,
  patch: { name, colorSeed: colorSeedFor(groupId, name), deletedAt: null },
});

export interface NewGroupInput {
  name: string;
  baseCurrency: CurrencyCode;
  /** The person holding this device: the first member and the actor. */
  myName: string;
  otherNames?: readonly string[];
}

export async function createGroup(
  input: NewGroupInput,
  now = Date.now(),
): Promise<{ groupId: Id; memberId: Id; secret: string }> {
  const groupId = newGroupId();
  const memberId = memberIdFor(groupId, input.myName);
  const secret = newGroupSecret();

  await saveGroupKey(groupId, secret);

  const device = await getDevice();

  await appendOps(
    groupId,
    memberId,
    [
      {
        entity: "group",
        entityId: groupId,
        kind: "create",
        patch: {
          name: input.name,
          baseCurrency: input.baseCurrency,
          createdAt: now,
          archivedAt: null,
        },
      },
      memberCreate(groupId, input.myName),
      {
        entity: "identity",
        entityId: device.nodeId,
        kind: "create",
        patch: { memberId, claimedAt: now },
      },
      // One batch, so history reads as the group created with these people in it.
      ...(input.otherNames ?? []).map((name) => memberCreate(groupId, name)),
    ],
    now,
  );

  await setMe(groupId, memberId);
  return { groupId, memberId, secret };
}

/** The secret never travels through an op, only through the link fragment. ADR-0003. */
export async function saveGroupKey(groupId: Id, secret: string): Promise<void> {
  // Sync walks key rows, so one would push the demo into D1
  // (docs/sync.md#the-demo-group-has-no-key). rules-check keeps this the only writer.
  if (isDemo(groupId)) throw new Error("the demo group is never given a key");
  const existing = await db().groupKeys.get(groupId);
  // A fresh link is the only cure for a 403, so it clears the failure.
  await db().groupKeys.put({
    ...existing, groupId, secret, lastSeq: existing?.lastSeq ?? 0, failure: undefined,
  });
  await unhideGroup(groupId);
  // This phone now holds something that exists nowhere else until it syncs.
  void requestPersistence();
}

/**
 * For a home-screen icon to bring along (docs/ios.md). From the keys, not the
 * groups: one just accepted has its key before its ops. Reads only (no
 * `getDevice`, which writes), so a live query can run it.
 */
export async function heldInvites(first?: Id): Promise<CarriedGroup[]> {
  const [keys, device] = await Promise.all([db().groupKeys.toArray(), db().device.get("device")]);
  const left = new Set(device?.leftGroups ?? []);
  const links = keys
    .filter((key) => !left.has(key.groupId))
    .map(({ groupId, secret }): CarriedGroup => {
      const me = device?.meByGroup[groupId];
      return me ? { groupId, secret, me } : { groupId, secret };
    });
  return [
    ...links.filter((link) => link.groupId === first),
    ...links.filter((link) => link.groupId !== first),
  ];
}

/**
 * Local but for one op: a subscribed phone writes `push: null` first, or the
 * group goes on buzzing it. Hidden at once, erased by the sync that sends its
 * last ops (`dropForgotten`), or an offline edit would never reach the others.
 */
export async function forgetGroup(groupId: Id): Promise<void> {
  const device = await getDevice();
  const identity = await db().identities.get([groupId, device.nodeId]);
  if (identity?.push) {
    await appendOps(groupId, device.meByGroup[groupId] ?? identity.memberId, [{
      entity: "identity", entityId: device.nodeId, kind: "update", patch: { push: null },
    }]);
  }
  await hideGroup(groupId);
  await dropForgotten(groupId);
}

/**
 * Checked inside the erase's transaction, so a write or a reopened link
 * landing meanwhile keeps it. Returns whether it went.
 */
export function dropForgotten(groupId: Id): Promise<boolean> {
  return erase(groupId, false);
}

/**
 * Only when the server deleted the group (the one event that is not an op) or
 * to clear the demo. The id goes into `deletedGroups` so screens can say so.
 */
export async function eraseGroupLocally(groupId: Id): Promise<void> {
  await erase(groupId, true);
}

async function erase(groupId: Id, deleted: boolean): Promise<boolean> {
  const d = db();
  const gone = await d.transaction("rw", [
    d.ops, d.groups, d.members, d.expenses, d.settlements,
    d.attachments, d.identities, d.rates, d.groupKeys, d.notices, d.device,
  ], async () => {
    if (!deleted) {
      const [device, queued] = await Promise.all([
        d.device.get("device"),
        d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).count(),
      ]);
      if (!device?.leftGroups?.includes(groupId) || queued > 0) return false;
    }
    await Promise.all([
      d.ops.where("groupId").equals(groupId).delete(),
      d.members.where("groupId").equals(groupId).delete(),
      d.expenses.where("groupId").equals(groupId).delete(),
      d.settlements.where("groupId").equals(groupId).delete(),
      d.attachments.where("groupId").equals(groupId).delete(),
      d.identities.where("groupId").equals(groupId).delete(),
      d.rates.where("groupId").equals(groupId).delete(),
      d.groups.delete(groupId),
      d.groupKeys.delete(groupId),
      d.notices.where("groupId").equals(groupId).delete(),
    ]);
    return true;
  });
  if (!gone) return false;
  forgetShown(groupId);
  // The worker's cursor holds the group's bearer; nothing of the group stays.
  await dropStash(groupId).catch(() => {});

  // After the transaction: the device record has one writer (../device.ts).
  const device = await getDevice();
  const { [groupId]: _gone, ...meByGroup } = device.meByGroup;
  await updateDevice({
    meByGroup,
    // A forgotten id stays in `leftGroups`, or a home-screen icon's carried key brings it back.
    ...(deleted ? {
      leftGroups: (device.leftGroups ?? []).filter((id) => id !== groupId),
      deletedGroups: [...new Set([...(device.deletedGroups ?? []), groupId])],
    } : {}),
    ...(device.lastOpenedGroupId === groupId ? { lastOpenedGroupId: undefined } : {}),
  });
  return true;
}

// -------------------------------------------------------------- identity

/**
 * An op, unlike everything else about "you": an `actor` is only readable if
 * the group sees when a device changed member. ADR-0003.
 */
export async function claimIdentity(
  groupId: Id,
  memberId: Id,
  now = Date.now(),
): Promise<void> {
  const device = await getDevice();
  const current = device.meByGroup[groupId];
  if (current === memberId) return;
  // A phone that forgot the group still has its claim on the log.
  const previous = current
    ?? (await db().identities.get([groupId, device.nodeId]))?.memberId;

  await setMe(groupId, memberId);
  if (previous !== memberId) {
    await appendOps(
      groupId,
      previous ?? memberId,
      [{
        entity: "identity",
        entityId: device.nodeId,
        kind: previous === undefined ? "create" : "update",
        patch: { memberId, claimedAt: now },
      }],
      now,
    );
  }
  void reconcilePush();
}

/**
 * Claims made before identity was on the log. `claimedAt` is when published:
 * an invented timestamp on the shared log is worse than a late one.
 */
export async function publishExistingClaims(now = Date.now()): Promise<void> {
  const device = await getDevice();
  const mine = await db().ops.where("entityId").equals(device.nodeId).toArray();
  const claimed = new Set(
    mine.filter((op) => op.entity === "identity").map((op) => op.groupId),
  );

  for (const [groupId, memberId] of Object.entries(device.meByGroup)) {
    if (claimed.has(groupId)) continue;
    // A group whose ops haven't been pulled yet isn't ours to write to.
    if (!(await db().groups.get(groupId))) continue;
    await appendOps(
      groupId,
      memberId,
      [{
        entity: "identity",
        entityId: device.nodeId,
        kind: "create",
        patch: { memberId, claimedAt: now },
      }],
      now,
    );
  }
}

// --------------------------------------------------------------- members

/** No `actor` for a joining phone adding its holder before claiming anybody. */
export async function addMember(groupId: Id, actor: Id | undefined, name: string): Promise<Id> {
  // Re-adding a removed member returns the person, balance and history included.
  const op = memberCreate(groupId, name);
  await appendOps(groupId, actor ?? op.entityId, [op]);
  return op.entityId;
}

/**
 * No screen calls this; renaming is being removed. Folding still reads the
 * `name` updates already written.
 */
export async function renameMember(
  groupId: Id,
  actor: Id,
  memberId: Id,
  name: string,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "update", patch: { name } },
  ]);
}

/** Their past expenses stay as they were: removing someone never redistributes what they owed. */
export async function removeMember(groupId: Id, actor: Id, memberId: Id): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "delete", patch: {} },
  ]);
}

/**
 * Repairs what a merge broke, to a fixed point: a guard constrains one
 * replica's view, never the union of two
 * ([docs/invariants.md](../../../../../docs/invariants.md)). Repairs are
 * ordinary ops, and idempotent: two devices healing at once write the same one.
 */
export async function healGroup(groupId: Id): Promise<number> {
  // Unclaimed, it heals nothing; the others will.
  const me = await getMe(groupId);
  if (!me) return 0;

  let written = 0;
  // Bounded: two healers that fought would write synced ops forever.
  for (let pass = 0; pass < 8; pass++) {
    const state = await groupState(groupId);
    // The claim first: putting this person back can strand entries the registry then heals.
    const registered = healDrafts(state);
    const claim = restoreClaimDrafts(state, me)
      .filter((d) => !registered.some((r) => r.entity === d.entity && r.entityId === d.entityId));
    const drafts = [...claim, ...registered];
    if (drafts.length === 0) break;
    await appendOps(groupId, me, drafts);
    written += drafts.length;
  }
  return written;
}

/** Device-local, so no op. Only forward: a screen leaving with a stale count mustn't bring old edits back. */
export async function markEditsSeen(groupId: Id, seq: number): Promise<void> {
  const d = db();
  await d.transaction("rw", d.groupKeys, async () => {
    const key = await d.groupKeys.get(groupId);
    if (key && seq > (key.seenSeq ?? 0)) await d.groupKeys.update(groupId, { seenSeq: seq });
  });
}
