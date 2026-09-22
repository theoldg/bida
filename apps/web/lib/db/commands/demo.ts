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
 * A real group, created as `createGroup` creates one, except `saveGroupKey` is
 * never called. `runSyncAll` drives off `groupKeys`, so a group with no key
 * cannot reach the server — and a syncing demo would register every tourist
 * into D1 (docs/sync.md#the-demo-group-has-no-key).
 *
 * **Nothing else in the app may write a `groupKeys` row for this id.**
 * `scripts/rules-check.mjs` holds that.
 */

/**
 * Create the demo, or reopen the one already here. Idempotent because the id
 * is a constant; one `appendOps` batch, so history reads as one arrival.
 *
 * Except: **a build whose seed changed throws the old demo away** (`demoStamp`)
 * — the demo is this version's pitch, not a group anyone keeps.
 */
export async function openDemo(now = Date.now()): Promise<Id> {
  const me = memberIdFor(DEMO_GROUP_ID, DEMO_ME);
  const stamp = demoStamp();

  if ((await getDevice()).demoSeed !== stamp && await db().groups.get(DEMO_GROUP_ID)) {
    // Erase rather than fold over the old: seed entity ids move between versions,
    // so anything the last story had would survive as a stray row.
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
 * Take the demo off the phone: its ops, its folded tables and the device's
 * memory of it. **`eraseGroupLocally`, never `forgetGroup`** — forgetting only
 * hides, leaving it on disk with no link to bring it back. Reset is this then
 * `openDemo`.
 */
export async function clearDemo(): Promise<void> {
  await eraseGroupLocally(DEMO_GROUP_ID);
}
