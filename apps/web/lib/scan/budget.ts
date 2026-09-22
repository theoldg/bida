"use client";

import { SCAN_LIMITS } from "@bida/core";
import { getDevice, updateDevice } from "../db/device";

/**
 * This phone's own copy of the caller budget (`SCAN_LIMITS.caller`).
 *
 * Advice, not enforcement — the Worker's count decides. It refuses an
 * over-budget scan before the photo is downscaled and sent. Wiping it only
 * reaches a bucket that was politeness anyway; the address and global caps
 * are the Worker's (docs/receipt-scanning.md#what-the-scan-costs).
 *
 * Per caller, not per phone: the server budgets each group's credential
 * separately, and one shared log here would refuse scans it allows.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Timestamps for one caller within the last day, oldest first. */
async function recent(id: string, now: number): Promise<number[]> {
  const device = await getDevice();
  return (device.scanLog ?? [])
    .filter((hit) => hit.id === id && hit.at > now - DAY)
    .map((hit) => hit.at);
}

/** True when this phone already knows the caller's budget is spent. */
export async function overCallerBudget(id: string, now = Date.now()): Promise<boolean> {
  const hits = await recent(id, now);
  return hits.length >= SCAN_LIMITS.caller.day
    || hits.filter((at) => at > now - HOUR).length >= SCAN_LIMITS.caller.hour;
}

/**
 * Book a scan against this phone's copy, pruning what has aged out. Written
 * before the request leaves, as the Worker does — a hung or unreadable scan
 * is still spent.
 */
export async function noteScan(id: string, now = Date.now()): Promise<void> {
  const device = await getDevice();
  const kept = (device.scanLog ?? []).filter((hit) => hit.at > now - DAY);
  await updateDevice({ scanLog: [...kept, { id, at: now }] });
}
