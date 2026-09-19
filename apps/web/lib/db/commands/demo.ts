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
 * A real group made of real ops, created exactly as `createGroup` creates one,
 * with a single thing left out — `saveGroupKey` is never called. That is the
 * whole mechanism: `runSyncAll` drives off `groupKeys.toArray()`, so a group
 * with no key cannot reach the server. `POST /ops` registers any unseen group
 * id into a D1 that gets no further resets, and a syncing demo would be a
 * one-tap door for every tourist (docs/sync.md#the-demo-group-has-no-key).
 *
 * **Nothing else in the app may write a `groupKeys` row for this id.**
 * `scripts/rules-check.mjs` holds that — it is the invariant here whose quiet
 * breakage starts writing tourists into the log.
 */

/**
 * Create the demo, or reopen the one that is already here.
 *
 * Idempotent because the id is a constant. The whole trip goes in one
 * `appendOps` batch, as `createGroup` does, so the log — and the history
 * screen — reads as one arrival rather than a dozen.
 *
 * One exception, and the reason `demoStamp` exists: **a build whose seed has
 * changed throws the old demo away and lays down the new one.** The demo is
 * this version's pitch, not a group somebody keeps, so idempotence across
 * releases would leave every phone showing a story we stopped telling.
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
 * **`eraseGroupLocally`, never `forgetGroup`** — forgetting only hides, and a
 * hidden demo is off the list, still on disk, with no link anywhere to bring
 * it back. The seed being deterministic, *reset* is this call and `openDemo`
 * in a row.
 */
export async function clearDemo(): Promise<void> {
  await eraseGroupLocally(DEMO_GROUP_ID);
}
