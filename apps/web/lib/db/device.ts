import { newNodeId } from "@hajsik/core";
import { db, type DeviceRecord } from "./dexie";

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

export async function setMe(groupId: string, memberId: string): Promise<void> {
  const device = await getDevice();
  await updateDevice({ meByGroup: { ...device.meByGroup, [groupId]: memberId } });
}

export async function setPersonalMode(on: boolean): Promise<void> {
  await updateDevice({ personalMode: on });
}
