"use client";

import { SCAN_LIMITS } from "@bida/core";
import { getDevice, updateDevice } from "../db/device";

/**
 * This phone's own copy of the caller budget (`SCAN_LIMITS.caller`).
 *
 * Advice, not enforcement — the Worker counts the same scans again and its
 * count is the one that decides. What this buys is that a scan already over
 * budget is refused *before* the photo is downscaled and sent, so the sentence
 * arrives at once and the request is never spent. It is trivially wiped, and
 * that is fine: wiping it only reaches a bucket that was politeness anyway,
 * and the two that are not — the address and the global cap — are the
 * Worker's. See docs/receipt-scanning.md#what-the-scan-costs.
 *
 * Kept per caller, not per phone: a device in three groups has three budgets
 * on the server, and one shared log here would refuse a scan the server would
 * have allowed.
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
 * Book a scan against this phone's copy, pruning what has aged out.
 *
 * Written before the request leaves, to match the Worker: a scan that hangs or
 * comes back unreadable has still been spent, and a phone that only counted
 * successes would keep offering a button the server refuses.
 */
export async function noteScan(id: string, now = Date.now()): Promise<void> {
  const device = await getDevice();
  const kept = (device.scanLog ?? []).filter((hit) => hit.at > now - DAY);
  await updateDevice({ scanLog: [...kept, { id, at: now }] });
}
