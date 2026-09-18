import {
  demoCast, demoOps, demoStamp, memberIdFor, DEMO_GROUP_ID, DEMO_ME, type Id,
} from "@bida/core";
import { db } from "../dexie";
import { getDevice, setMe, unhideGroup, updateDevice } from "../device";
import { appendOps } from "./append";
import { eraseGroupLocally } from "./groups";

/**
 * The demo group: open it, and clear it.
 *
 * A real group made of real ops, created exactly the way `createGroup` creates
 * one, with a single thing left out — `saveGroupKey` is never called. That is
 * the whole mechanism: `runSyncAll` drives off `groupKeys.toArray()` and
 * `syncGroupOnce` returns early with no key row, so a group with no key is
 * structurally incapable of reaching the server. There is no flag to flip and
 * no path to disable, which is the point rather than the tidiness: `POST /ops`
 * registers any unseen group id into a D1 that gets no further resets, and a
 * syncing demo would be a one-tap door for every tourist
 * (docs/sync.md#the-demo-group-has-no-key).
 *
 * **Nothing else in the app may write a `groupKeys` row for this id**, and
 * `scripts/rules-check.mjs` holds that: it is the one invariant here whose
 * quiet breakage starts writing tourists into the log.
 */

/**
 * Create the demo, or reopen the one that is already here.
 *
 * Idempotent because the id is a constant: opening `/demo` twice reopens the
 * one group instead of stacking copies. The whole trip goes in one `appendOps`
 * batch, as `createGroup` does, so the log reads as one arrival rather than a
 * dozen — which is also what the history screen shows.
 *
 * With one exception, and it is the reason `demoStamp` exists: **a build whose
 * seed has changed throws the old demo away and lays down the new one.** The
 * demo is this version's pitch rather than a group somebody keeps, so
 * idempotence across releases is the wrong kind — it left every phone that had
 * ever opened `/demo` showing the story we stopped telling, with no way back
 * short of Clear the demo. The stamp is a fingerprint of the seed itself, so
 * nothing has to be remembered to bump.
 */
export async function openDemo(now = Date.now()): Promise<Id> {
  const me = memberIdFor(DEMO_GROUP_ID, DEMO_ME);
  const stamp = demoStamp();

  if ((await getDevice()).demoSeed !== stamp && await db().groups.get(DEMO_GROUP_ID)) {
    // Erase rather than fold the new ops over the old: the seed's entity ids
    // move between versions, so anything the last story had and this one does
    // not would survive as a stray row nobody wrote.
    await clearDemo();
  }
  if (!(await db().groups.get(DEMO_GROUP_ID))) {
    const device = await getDevice();
    await appendOps(DEMO_GROUP_ID, me, demoOps(demoCast(device.nodeId), now), now);
    await updateDevice({ demoSeed: stamp });
  }

  // Read the device after the writes above, not before: clearing the demo
  // patches this same record, and a copy taken earlier would put its
  // `deletedGroups` back.
  const device = await getDevice();
  // Say who this phone is before the ledger asks: an unclaimed group sends you
  // to the claim gate, and being one of the four is what the demo is for.
  await setMe(DEMO_GROUP_ID, me);
  await unhideGroup(DEMO_GROUP_ID);
  // A demo cleared earlier left its id in `deletedGroups`, which is how the
  // screens tell a deleted group from a bad link. Reopening un-says that.
  if (device.deletedGroups?.includes(DEMO_GROUP_ID)) {
    await updateDevice({
      deletedGroups: device.deletedGroups.filter((id) => id !== DEMO_GROUP_ID),
    });
  }
  return DEMO_GROUP_ID;
}

/**
 * Take the demo off the phone: its ops, every table folded from them, and the
 * device's memory of it.
 *
 * `eraseGroupLocally` and not `forgetGroup`, which only hides. A hidden demo is
 * a group that is gone from the list and still on disk, with no link anywhere
 * to bring it back — the one case where forgetting would be the wrong half of
 * the pair. Because the seed is deterministic, *reset* and *clear, then
 * reopen* are this call and `openDemo` in a row.
 */
export async function clearDemo(): Promise<void> {
  await eraseGroupLocally(DEMO_GROUP_ID);
}
