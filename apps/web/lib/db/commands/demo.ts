import { demoCast, demoStamp, demoTimeline, DEMO_GROUP_ID, type Id } from "@bida/core";
import { db } from "../dexie";
import { getDevice, unhideGroup, updateDevice } from "../device";
import { appendOps } from "./append";
import { claimIdentity, eraseGroupLocally } from "./groups";

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
 * is a constant; one `appendOps` batch per step of `demoTimeline`, so history
 * reads as the trip it tells, each change by its own author.
 *
 * Except: **a build whose seed changed throws the old demo away** (`demoStamp`)
 * — the demo is this version's pitch, not a group anyone keeps.
 */
export async function openDemo(now = Date.now()): Promise<Id> {
  const stamp = demoStamp();
  // Who the visitor said they were, kept across a re-seed: a new build is not
  // a reason to ask again. Member ids derive from names, so it still exists.
  let kept: Id | undefined;

  if ((await getDevice()).demoSeed !== stamp && await db().groups.get(DEMO_GROUP_ID)) {
    kept = (await getDevice()).meByGroup[DEMO_GROUP_ID];
    // Erase rather than fold over the old: seed entity ids move between versions,
    // so anything the last story had would survive as a stray row.
    await clearDemo();
  }
  if (!(await db().groups.get(DEMO_GROUP_ID))) {
    // Unstamped until the last step lands: a tab that dies between steps
    // leaves a half-told story, which the next visit then erases and retells.
    await updateDevice({ demoSeed: undefined });
    for (const step of demoTimeline(demoCast(), now)) {
      await appendOps(DEMO_GROUP_ID, step.by, step.ops, step.at);
    }
    await updateDevice({ demoSeed: stamp });
    if (kept) await claimIdentity(DEMO_GROUP_ID, kept);
  }

  // Read the device after the writes above, not before: clearing the demo
  // patches this same record, and a copy taken earlier would put its
  // `deletedGroups` back.
  const device = await getDevice();
  // Nobody is claimed: the ledger's claim gate asks which of the four you are,
  // the same question a joined group asks, so the personal lens is one you chose.
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
 * Whether a demo address reaching this phone should go to `/demo`: it has no
 * demo, and never cleared one. **Read here, not off the screen's live read**,
 * which answers with the last value it had while the new one runs — "no group"
 * on the way back from `/demo`, and a loop. And not after a clear, whose
 * `eraseGroupLocally` leaves the ledger drawing no group before the menu has
 * navigated away; that phone has been told the address already.
 */
export async function wantsDemo(): Promise<boolean> {
  if (await db().groups.get(DEMO_GROUP_ID)) return false;
  return !(await getDevice()).deletedGroups?.includes(DEMO_GROUP_ID);
}

/**
 * Take the demo off the phone: its ops, its folded tables and the device's
 * memory of it. **`eraseGroupLocally`, never `forgetGroup`** — forgetting
 * waits for the group's ops to reach the server, and the demo's never do.
 * Reset is this then `openDemo`.
 */
export async function clearDemo(): Promise<void> {
  await eraseGroupLocally(DEMO_GROUP_ID);
}
