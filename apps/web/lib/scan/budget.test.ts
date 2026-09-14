import { SCAN_LIMITS } from "@bida/core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/dexie";
import { noteScan, overCallerBudget } from "./budget";

/**
 * The phone's copy of the caller budget. It is advice — the Worker decides —
 * but advice that refuses one scan too early is a button that lies, and advice
 * that never refuses spends a request to be told the same thing. Both edges
 * matter, and so does the per-caller keying: a phone in three groups has three
 * budgets on the server and must not enforce one here.
 */

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

beforeEach(async () => { await db().device.clear(); });

async function spend(n: number, id: string, from: number, spacing: number) {
  for (let i = 0; i < n; i++) await noteScan(id, from - i * spacing);
}

describe("overCallerBudget", () => {
  it("allows a phone that has never scanned", async () => {
    expect(await overCallerBudget("g1", NOW)).toBe(false);
  });

  it("allows one short of the hour, refuses on it", async () => {
    await spend(SCAN_LIMITS.caller.hour - 1, "g1", NOW, 1000);
    expect(await overCallerBudget("g1", NOW)).toBe(false);
    await noteScan("g1", NOW);
    expect(await overCallerBudget("g1", NOW)).toBe(true);
  });

  it("refuses on the day even when the hour is clear", async () => {
    await spend(SCAN_LIMITS.caller.day, "g1", NOW, 5 * 60 * 1000);
    expect(await overCallerBudget("g1", NOW)).toBe(true);
  });

  it("lets an hour-old burst expire", async () => {
    await spend(SCAN_LIMITS.caller.hour, "g1", NOW - 2 * HOUR, 1000);
    expect(await overCallerBudget("g1", NOW)).toBe(false);
  });

  it("keeps one caller's budget out of another's", async () => {
    await spend(SCAN_LIMITS.caller.hour, "g1", NOW, 1000);
    expect(await overCallerBudget("g1", NOW)).toBe(true);
    expect(await overCallerBudget("g2", NOW)).toBe(false);
  });

  it("drops hits older than a day as it writes", async () => {
    await noteScan("g1", NOW - 25 * HOUR);
    await noteScan("g1", NOW);
    const device = await db().device.get("device");
    expect(device?.scanLog).toEqual([{ id: "g1", at: NOW }]);
  });
});
