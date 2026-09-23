import { newNodeId } from "@bida/core";
import { started } from "../diag";
import { db, type DeviceRecord } from "./dexie";
import { whenVisible } from "./visible";

const DEFAULTS: Omit<DeviceRecord, "nodeId"> = {
  key: "device",
  hlcPhysical: 0,
  hlcCounter: 0,
  meByGroup: {},
  // Until the menu on the groups list is used, the phone's own setting
  // decides — see components/home-menu.tsx.
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
  // Named by the fields it sets: navigating writes this row (the last group
  // opened, the list left on), and a write on every tap is worth seeing.
  const done = started("device.write", Object.keys(patch).join(","));
  try {
    // Never from a background page (./visible.ts). `device` is read by every
    // list and group screen, so a put frozen here leaves them all on skeletons.
    await whenVisible("device.write");
    // Read inside the gate so unnamed fields come from the record as it is now,
    // not as it was before a long park.
    const current = await getDevice();
    await db().device.put({ ...current, ...patch, key: "device" });
  } finally {
    done();
  }
}

/** Which member this device is, in a given group. Undefined until claimed. */
export async function getMe(groupId: string): Promise<string | undefined> {
  const device = await getDevice();
  return device.meByGroup[groupId];
}

/**
 * Point this device at a member, without touching the op log. Device-local
 * half only: call `claimIdentity` (./commands.ts), which also writes the
 * `identity` op (ADR-0003). Here so the device record has one writer.
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

/**
 * Forget a group on this phone, device-local only: hide it from the groups
 * list and drop which member this phone was in it, in one write. Opening the
 * link again then asks "who are you" afresh rather than walking back in as
 * whoever last held the phone.
 */
export async function hideGroup(groupId: string): Promise<void> {
  const device = await getDevice();
  const hidden = device.leftGroups?.includes(groupId) ?? false;
  const claimed = groupId in device.meByGroup;
  if (hidden && !claimed) return;
  const { [groupId]: _forgotten, ...meByGroup } = device.meByGroup;
  await updateDevice({
    meByGroup,
    leftGroups: hidden ? device.leftGroups : [...(device.leftGroups ?? []), groupId],
  });
}

/** Undo `hideGroup` — opening the group's invite link again un-forgets it. */
export async function unhideGroup(groupId: string): Promise<void> {
  const device = await getDevice();
  if (!device.leftGroups?.includes(groupId)) return;
  await updateDevice({ leftGroups: device.leftGroups.filter((id) => id !== groupId) });
}

/** Fold the groups list's install offer shut, or open it again. */
export async function setInstallNudgeCollapsed(collapsed: boolean): Promise<void> {
  const device = await getDevice();
  if ((device.installNudgeCollapsed ?? false) === collapsed) return;
  await updateDevice({ installNudgeCollapsed: collapsed });
}

export async function setNotifyNudgeCollapsed(collapsed: boolean): Promise<void> {
  const device = await getDevice();
  if ((device.notifyNudgeCollapsed ?? false) === collapsed) return;
  await updateDevice({ notifyNudgeCollapsed: collapsed });
}

/** Read a scanned bill in English, or back in the language it was printed in. */
export async function setBillEnglish(english: boolean): Promise<void> {
  await updateDevice({ billEnglish: english ? true : undefined });
}

/**
 * Point this phone's scans at a key its owner brought, or back at the shared
 * one. Device-local, never an op — see `DeviceRecord.geminiKey`. Trimmed
 * because pasted keys carry newlines; removal is `undefined`, the same absent
 * every phone that never pasted one reads.
 */
export async function setGeminiKey(key: string | undefined): Promise<void> {
  const trimmed = key?.trim();
  await updateDevice({ geminiKey: trimmed ? trimmed : undefined });
}
