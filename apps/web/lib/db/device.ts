import { newNodeId } from "@hajsik/core";
import { db, type DeviceRecord } from "./dexie";

/**
 * Bumped when a *default* changes in a way that should reach phones that
 * already have a device record. The record is device-local and unsynced, so
 * this is a plain field, not a Dexie schema version — nothing is indexed on it.
 */
const PREFS_VERSION = 1;

const DEFAULTS: Omit<DeviceRecord, "nodeId"> = {
  key: "device",
  hlcPhysical: 0,
  hlcCounter: 0,
  // On, because the question the app is open to answer is "what does this cost
  // me?" — see docs/product.md. Turning it off is a deliberate act; having it
  // off was not.
  personalMode: true,
  meByGroup: {},
  theme: "system",
  prefsVersion: PREFS_VERSION,
};

/** Read the device record, creating it on first run and updating stale defaults. */
export async function getDevice(): Promise<DeviceRecord> {
  const existing = await db().device.get("device");
  if (existing) return migrateDefaults(existing);
  const fresh: DeviceRecord = { ...DEFAULTS, nodeId: newNodeId() };
  await db().device.put(fresh);
  return fresh;
}

/**
 * A phone that installed the app before 2026-08-28 carries `personalMode:
 * false` that nobody chose — it was the default at the time. Flipping the
 * default alone would leave exactly the existing users looking at the old app.
 * This runs once per phone; a later "Off" sticks, because the version marker
 * is already current by then.
 */
async function migrateDefaults(record: DeviceRecord): Promise<DeviceRecord> {
  if (record.prefsVersion === PREFS_VERSION) return record;
  const next: DeviceRecord = { ...record, personalMode: true, prefsVersion: PREFS_VERSION };
  await db().device.put(next);
  return next;
}

export async function updateDevice(patch: Partial<DeviceRecord>): Promise<void> {
  const current = await getDevice();
  await db().device.put({ ...current, ...patch, key: "device" });
}

/** Which member this device is, in a given group. Undefined until claimed. */
export async function getMe(groupId: string): Promise<string | undefined> {
  const device = await getDevice();
  return device.meByGroup[groupId];
}

/**
 * Point this device at a member, without touching the op log.
 *
 * This is the device-local half only. Nothing outside this module should call
 * it: `claimIdentity` in ./commands.ts is the whole operation — it writes the
 * `identity` op that lets everybody else read `Op.actor` honestly (ADR-0011),
 * and calls this. Kept here, and kept private-by-convention, so that the
 * device record still has exactly one writer.
 */
export async function setMe(groupId: string, memberId: string): Promise<void> {
  const device = await getDevice();
  if (device.meByGroup[groupId] === memberId) return;
  await updateDevice({ meByGroup: { ...device.meByGroup, [groupId]: memberId } });
}

export async function setPersonalMode(on: boolean): Promise<void> {
  await updateDevice({ personalMode: on });
}

/**
 * Drop this device's claim on a group, e.g. after the member it pointed at
 * left the group. Device-local only — the claim itself was never synced,
 * only its `identity` op was, and that op is history, not a pointer to clear.
 */
export async function forgetMe(groupId: string): Promise<void> {
  const device = await getDevice();
  if (!(groupId in device.meByGroup)) return;
  const meByGroup = { ...device.meByGroup };
  delete meByGroup[groupId];
  await updateDevice({ meByGroup });
}
