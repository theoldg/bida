import { newNodeId } from "@bida/core";
import { db, type DeviceRecord } from "./dexie";

const DEFAULTS: Omit<DeviceRecord, "nodeId"> = {
  key: "device",
  hlcPhysical: 0,
  hlcCounter: 0,
  meByGroup: {},
  // Until the toggle on the groups list is tapped, the phone's own setting
  // decides — see components/theme-toggle.tsx.
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
 * Point this device at a member, without touching the op log.
 *
 * This is the device-local half only. Nothing outside this module should call
 * it: `claimIdentity` in ./commands.ts is the whole operation — it writes the
 * `identity` op that lets everybody else read `Op.actor` honestly (ADR-0003),
 * and calls this. Kept here, and kept private-by-convention, so that the
 * device record still has exactly one writer.
 */
export async function setMe(groupId: string, memberId: string): Promise<void> {
  const device = await getDevice();
  if (device.meByGroup[groupId] === memberId) return;
  await updateDevice({ meByGroup: { ...device.meByGroup, [groupId]: memberId } });
}

/**
 * Record the group this device just opened — read back by `/new` to seed its
 * currency, and by a launch to reopen it (lib/launch.ts). Being in a group is
 * also how this device stops being on the list.
 */
export async function setLastOpenedGroup(groupId: string): Promise<void> {
  const device = await getDevice();
  if (device.lastOpenedGroupId === groupId && !device.leftOnList) return;
  await updateDevice({ lastOpenedGroupId: groupId, leftOnList: false });
}

/**
 * Record that the groups list is where this device now is, so the next launch
 * leaves it there rather than reopening the last group (lib/launch.ts).
 */
export async function setLeftOnList(): Promise<void> {
  const device = await getDevice();
  if (device.leftOnList) return;
  await updateDevice({ leftOnList: true });
}

/** Hide a group from this phone's groups list — forgetting it, device-local only. */
export async function hideGroup(groupId: string): Promise<void> {
  const device = await getDevice();
  if (device.leftGroups?.includes(groupId)) return;
  await updateDevice({ leftGroups: [...(device.leftGroups ?? []), groupId] });
}

/** Undo `hideGroup` — opening the group's invite link again un-forgets it. */
export async function unhideGroup(groupId: string): Promise<void> {
  const device = await getDevice();
  if (!device.leftGroups?.includes(groupId)) return;
  await updateDevice({ leftGroups: device.leftGroups.filter((id) => id !== groupId) });
}
