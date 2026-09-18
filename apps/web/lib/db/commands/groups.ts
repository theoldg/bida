import {
  colorSeedFor, healDrafts, memberIdFor, newGroupId, newGroupSecret, restoreClaimDrafts,
  type CurrencyCode, type Id,
} from "@bida/core";
import { db } from "../dexie";
import { groupState } from "../fold";
import { getDevice, getMe, hideGroup, setMe, unhideGroup, updateDevice } from "../device";
import { requestPersistence } from "../../persist";
import type { CarriedGroup } from "../../group-link";
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
      {
        entity: "member",
        entityId: memberId,
        kind: "create",
        patch: {
          name: input.myName, colorSeed: colorSeedFor(groupId, input.myName), deletedAt: null,
        },
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
        entityId: memberIdFor(groupId, name),
        kind: "create" as const,
        patch: { name, colorSeed: colorSeedFor(groupId, name), deletedAt: null },
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
 * Every group this phone holds, and who it is in each, for a home-screen icon
 * to bring along (docs/ios.md).
 *
 * The secrets, not the groups they open: one just accepted has its key before
 * its ops, and it is the very group the person is installing for. Forgotten
 * groups are left out — the key outlives `forgetGroup`, because re-opening the
 * link is how you come back, and an icon that walks back into a group this
 * phone said it was done with is the one thing carrying them all could get
 * wrong.
 *
 * `first` goes at the head: the group the screen that asked is about. Reads
 * only — no `getDevice`, which creates the row — so a live query can run it.
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
 * Forget a group on this phone: hides it from this device's list and drops
 * which member this phone is in it. Purely local — nothing is appended to the
 * op log, so it's invisible to everyone else in the group and there's nothing
 * for history to show. Membership is untouched; opening the invite link again
 * (`saveGroupKey`) un-forgets it and the claim gate asks who is holding the
 * phone, since after a forget that may well be somebody else. The identity
 * row on the log stays until that answer overwrites it. Groups are never
 * deleted, whether forgotten by everyone or not.
 */
export async function forgetGroup(groupId: Id): Promise<void> {
  await hideGroup(groupId);
}

/**
 * Take one group off this phone for good: its ops, every table folded from
 * them, the link secret, and what the device record remembers of it. The id is
 * written to `deletedGroups` so the screens can say what happened rather than
 * showing a group that has silently stopped existing.
 *
 * The other half of `forgetGroup`, and nothing like it. This runs when the
 * group has been deleted from the server (`/delete-my-data`, or a 410 met by
 * the sync engine on any phone that still held it), which is the one event in
 * this app that is not an op and cannot be undone. Nothing is appended and
 * nothing is left to fold: there is no group to record it in.
 */
export async function eraseGroupLocally(groupId: Id): Promise<void> {
  const d = db();
  await d.transaction("rw", [
    d.ops, d.groups, d.members, d.expenses, d.settlements,
    d.attachments, d.identities, d.rates, d.groupKeys,
  ], async () => {
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
    ]);
  });

  // The device record has one writer (../device.ts), so it is patched after
  // the transaction rather than inside it.
  const device = await getDevice();
  const { [groupId]: _gone, ...meByGroup } = device.meByGroup;
  await updateDevice({
    meByGroup,
    leftGroups: (device.leftGroups ?? []).filter((id) => id !== groupId),
    deletedGroups: [...new Set([...(device.deletedGroups ?? []), groupId])],
    ...(device.lastOpenedGroupId === groupId ? { lastOpenedGroupId: undefined } : {}),
  });
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
  const current = device.meByGroup[groupId];
  if (current === memberId) return;
  // A phone that forgot the group has no `meByGroup` entry but still has its
  // claim on the log, so that is what decides create-or-update and who the
  // switch is filed under.
  const previous = current
    ?? (await db().identities.get([groupId, device.nodeId]))?.memberId;

  await setMe(groupId, memberId);
  if (previous === memberId) return;
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
  // The name *is* the id (core/names.ts). Two phones adding "Ana" offline
  // therefore write one entity rather than two people nothing on screen tells
  // apart, and the fold merges the creates. It also means re-adding somebody
  // who was removed returns the person, balance and history included, rather
  // than a stranger with their name.
  const memberId = memberIdFor(groupId, name);
  await appendOps(groupId, actor ?? memberId, [
    {
      entity: "member",
      entityId: memberId,
      kind: "create",
      patch: { name, colorSeed: colorSeedFor(groupId, name), deletedAt: null },
    },
  ]);
  return memberId;
}

/**
 * No screen calls this any more — the rename button is gone from People, and
 * renaming is on its way out of the log too (owner, 2026-09-05). Kept only
 * until that lands; folding still has to read the `name` updates already
 * written by every group that used it.
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
 * Repair every invariant the merged log has broken, and put this phone's own
 * member back if the merge removed them — `INVARIANTS` in
 * `core/invariants.ts`, run to a fixed point.
 *
 * Reaching any of these takes two phones, each right on its own evidence: one
 * removes Bruno, the other — offline — writes a transfer to him; one clears the
 * MAD rate, the other writes a dinner in MAD. Every guard in the app is a
 * courtesy that constrains one replica's view of the log and cannot constrain
 * the union of two ([docs/invariants.md](../../../../../docs/invariants.md)),
 * so what makes the state legal again is this, not the refusal.
 *
 * The repairs are ordinary ops — a `deletedAt: null` lift, exactly what
 * re-adding a member or re-setting a cleared rate already writes — so nothing
 * about the fold, the wire format or history has to learn a new shape.
 *
 * Idempotent, and safe to call from anywhere: it reads the log itself, a healed
 * state fails its own detector, and two devices noticing at once write the same
 * repair, which folds to the same state. The loop is what makes it total —
 * repairing one invariant can reveal another — and it terminates because each
 * pass either writes nothing or strictly reduces what the detectors find,
 * which `invariants.test.ts` holds every registered entry to.
 */
export async function healGroup(groupId: Id): Promise<number> {
  // Who this phone is, which is both the signature on the repairs and — for
  // the claim below — the thing being repaired. A device that hasn't said who
  // it is has no honest name to sign with and nothing of its own to put back,
  // so it heals nothing; the phones that are in the group will.
  const me = await getMe(groupId);
  if (!me) return 0;

  let written = 0;
  // Bounded rather than `while (true)`: a healer pair that did fight would
  // otherwise write ops forever, and an op loop that syncs is the worst
  // failure this file could have. The test proves the fixed point; this is
  // what keeps a future mistake cheap.
  for (let pass = 0; pass < 8; pass++) {
    const state = await groupState(groupId);
    // The claim first, because it is the one repair the registry cannot make
    // (`restoreClaimDrafts`) and because putting this person back can strand
    // the entries they were paying for, which the registered healers then see.
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
