import { newNodeId } from "@hajsik/core";
import { db, type DeviceRecord, type IdentityEntry } from "./dexie";

const DEFAULTS: Omit<DeviceRecord, "nodeId"> = {
  key: "device",
  hlcPhysical: 0,
  hlcCounter: 0,
  personalMode: false,
  meByGroup: {},
  theme: "system",
};

/** Read the device record, creating it on first run. */
export async function getDevice(): Promise<DeviceRecord> {
  const existing = await db().device.get("device");
  if (existing) return existing;
  const fresh: DeviceRecord = { ...DEFAULTS, nodeId: newNodeId() };
  await db().device.put(fresh);
  return fresh;
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
 * Claim, or switch, which member this device is in a group — and record it.
 *
 * The log is device-local (see `IdentityEntry`): switching identity is not a
 * change to the group's ledger, so it must never become an op. Re-claiming the
 * same member is a no-op and is not logged.
 */
export async function setMe(
  groupId: string,
  memberId: string,
  now = Date.now(),
): Promise<void> {
  const device = await getDevice();
  const previous = device.meByGroup[groupId];
  if (previous === memberId) return;
  await updateDevice({ meByGroup: { ...device.meByGroup, [groupId]: memberId } });
  await db().identityLog.add({
    groupId,
    at: now,
    fromMember: previous ?? null,
    toMember: memberId,
  });
}

/** This device's identity changes in a group, oldest first. */
export async function identityHistory(groupId: string): Promise<IdentityEntry[]> {
  const rows = await db().identityLog.where("groupId").equals(groupId).toArray();
  return rows.sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
}

export async function setPersonalMode(on: boolean): Promise<void> {
  await updateDevice({ personalMode: on });
}
