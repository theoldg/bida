import {
  newColorSeed, newGroupSecret, newId, strandedMembers,
  type CurrencyCode, type Id,
} from "@hajsik/core";
import { db } from "../dexie";
import { getDevice, hideGroup, setMe, unhideGroup } from "../device";
import { requestPersistence } from "../../persist";
import { appendOps } from "./append";

/**
 * A group, who this phone is in it, and who else is. Three things that only
 * look like three: a group is created with its people in it, and the device
 * says which of them it speaks for in the same breath.
 */

export interface NewGroupInput {
  name: string;
  baseCurrency: CurrencyCode;
  /** The person holding this device. Becomes the first member and the actor. */
  myName: string;
  /** Everyone else, in the order they were typed. Optional — they can be added later. */
  otherNames?: readonly string[];
}

export async function createGroup(
  input: NewGroupInput,
  now = Date.now(),
): Promise<{ groupId: Id; memberId: Id; secret: string }> {
  const groupId = newId();
  const memberId = newId();
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
      {
        entity: "member",
        entityId: memberId,
        kind: "create",
        patch: { name: input.myName, colorSeed: newColorSeed(), deletedAt: null },
      },
      {
        entity: "identity",
        entityId: device.nodeId,
        kind: "create",
        patch: { memberId, claimedAt: now },
      },
      // The rest of the group, in the same batch: one HLC run, so the log reads
      // as the group being created with these people in it rather than as five
      // separate arrivals a millisecond apart.
      ...(input.otherNames ?? []).map((name) => ({
        entity: "member" as const,
        entityId: newId(),
        kind: "create" as const,
        patch: { name, colorSeed: newColorSeed(), deletedAt: null },
      })),
    ],
    now,
  );

  await setMe(groupId, memberId);
  return { groupId, memberId, secret };
}

/**
 * Store the secret from an invite link. Called on the creating device (from
 * `createGroup`) and on a device that just opened a `/join` link — the secret
 * never travels through an op, only through the link fragment. ADR-0003.
 */
export async function saveGroupKey(groupId: Id, secret: string): Promise<void> {
  const existing = await db().groupKeys.get(groupId);
  // A fresh link is the only cure for a 403, so opening one clears the failure
  // rather than leaving the old warning up over a key that now works.
  await db().groupKeys.put({
    ...existing, groupId, secret, lastSeq: existing?.lastSeq ?? 0, failure: undefined,
  });
  // Opening the link is what "rejoining" means here — surface the group
  // again if this device had previously left it.
  await unhideGroup(groupId);
  // This phone now holds something that exists nowhere else until it syncs.
  // Not awaited: whether the browser agrees to keep it doesn't gate the join.
  void requestPersistence();
}

/**
 * Forget a group on this phone: hides it from this device's list. Purely
 * local — nothing is appended to the op log, so it's invisible to everyone
 * else in the group and there's nothing for history to show. Membership and
 * this device's claimed identity are untouched, so opening the invite link
 * again (`saveGroupKey`) un-forgets it with no fuss. Groups are never
 * deleted, whether forgotten by everyone or not.
 */
export async function forgetGroup(groupId: Id): Promise<void> {
  await hideGroup(groupId);
}

// -------------------------------------------------------------- identity

/**
 * Say who is holding this phone in a group — the first claim, or a switch.
 *
 * This writes an op, unlike everything else about "you": every other op
 * carries an `actor`, and an actor is only readable if the group can see when
 * a device changed which member it speaks for. The claim is keyed by the
 * device's HLC node id, which is already the suffix of every op that device
 * ever stamped, so it publishes nothing the log did not already carry — it
 * just makes it legible. ADR-0003.
 *
 * Re-claiming the member you already are is a no-op and writes nothing.
 */
export async function claimIdentity(
  groupId: Id,
  memberId: Id,
  now = Date.now(),
): Promise<void> {
  const device = await getDevice();
  const previous = device.meByGroup[groupId];
  if (previous === memberId) return;

  await setMe(groupId, memberId);
  await appendOps(
    groupId,
    // The member who was here a moment ago is who made this change. On a
    // first claim there is nobody else it could be.
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

/**
 * Publish claims this device made before identity was on the log.
 *
 * A device that claimed a member under ADR-0003 has a `meByGroup` entry and no
 * op to show for it: its edits are attributed to somebody with nothing in the
 * log to explain why, and /g/history has nothing to show for a phone that has
 * been in the group for weeks. One `create` op per such group, once — later runs see it
 * and do nothing.
 *
 * `claimedAt` is when the claim was published, not when it was made. The
 * earlier date only ever existed in a device-local table that ADR-0003 drops,
 * and inventing a timestamp for the shared log would be worse than a late one.
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

/**
 * `actor` is optional because of the one case where there isn't one yet: a
 * phone joining a group adds the person holding it before it has claimed
 * anybody, and "someone added Theo" is a worse account of that than the
 * person arriving under their own name.
 */
export async function addMember(groupId: Id, actor: Id | undefined, name: string): Promise<Id> {
  const memberId = newId();
  await appendOps(groupId, actor ?? memberId, [
    {
      entity: "member",
      entityId: memberId,
      kind: "create",
      patch: { name, colorSeed: newColorSeed(), deletedAt: null },
    },
  ]);
  return memberId;
}

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

/**
 * Tombstone a member. Their past expenses stay exactly as they were — removing
 * someone must never silently redistribute money they already owed.
 */
export async function removeMember(groupId: Id, actor: Id, memberId: Id): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "delete", patch: {} },
  ]);
}

/**
 * Put back every member the group removed and then went on naming — the state
 * `strandedMembers` (core/payers.ts) describes.
 *
 * Removal is refused while anybody is named on a live entry, so this only
 * happens when two phones are each right at once: one removes Bruno, the other
 * — offline — writes a transfer to him, and the merge leaves a tombstoned
 * member holding money. The tombstone is the half the log has since
 * contradicted: an entry is money somebody typed, a removal is only the claim
 * that nobody was naming them. So the tombstone gives way, and the debt has a
 * way out again — before this, the balances tab offered a settle-up row that
 * the transfer form then refused, because no picker offers a member who has
 * left.
 *
 * Lifting it is an ordinary `deletedAt: null`, exactly as re-setting a cleared
 * rate lifts that row's tombstone (rates.ts); `lib/history-copy.ts` turns it
 * into the one sentence saying why somebody reappeared. Idempotent: it reads
 * the tables itself, and a member who is back is no longer stranded, so every
 * run after the first writes nothing. Two devices noticing at once write the
 * same lift, which folds to the same state.
 */
export async function readdStrandedMembers(groupId: Id, actor: Id): Promise<Id[]> {
  const d = db();
  const [members, expenses, settlements] = await Promise.all([
    d.members.where("groupId").equals(groupId).toArray(),
    d.expenses.where("groupId").equals(groupId).toArray(),
    d.settlements.where("groupId").equals(groupId).toArray(),
  ]);
  const stranded = strandedMembers(members, { expenses, settlements });
  if (stranded.length === 0) return [];

  await appendOps(groupId, actor, stranded.map((m) => ({
    entity: "member" as const,
    entityId: m.id,
    kind: "update" as const,
    patch: { deletedAt: null },
  })));
  return stranded.map((m) => m.id);
}
