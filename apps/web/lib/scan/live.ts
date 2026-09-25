"use client";

import { useSyncExternalStore } from "react";
import type { ScanMedium } from "@bida/core";
import { signal } from "../signal";

/** Where a scan is: idle, in flight, or refused. */
export type ScanState = "idle" | "scanning" | "error";

/**
 * The scan in flight for a group, or the last one's refusal.
 *
 * **Never hold this in a component's `useState`.** The screens a scan starts
 * from unmount under it (the Items tab on Evenly, the form under the payers
 * editor and grid), and coming back would restart "Reading…" from zero.
 */
export interface LiveScan {
  state: Exclude<ScanState, "idle">;
  /** Why the last scan failed, already worded for a person. Null falls back to the generic message. */
  error: string | null;
  /** When the scan began; the bar draws from this, so a remounted bar resumes. */
  startedAt: number;
  /** The sweep this scan was given, in seconds — see `sweepSeconds`. */
  seconds: number;
  /**
   * Photo or typed bill. Sets the bar's pace and a refusal's wording — "try a
   * flatter photo" is nonsense about typing.
   */
  medium: ScanMedium;
}

/**
 * How long one sweep lasts: ~3s for a photo, ~2s for a typed bill, jittered.
 * **Drawn once per scan, never per mount** — per scan so it doesn't look
 * canned, not per mount so a returning bar keeps its estimate.
 *
 * Keep it tracking real cost (model, Turnstile, two D1 round trips): a bar
 * that fills early and hands to a spinner admits it was guessing.
 */
function sweepSeconds(medium: ScanMedium): number {
  return medium === "text" ? 1.8 + Math.random() * 0.4 : 2.8 + Math.random() * 0.4;
}

const scans = new Map<string, LiveScan>();
const { emit, subscribe } = signal();

/** A scan has just been sent. Clears whatever the last one refused with. */
export function beginScan(groupId: string, medium: ScanMedium = "photo"): void {
  scans.set(groupId, {
    state: "scanning", error: null, startedAt: Date.now(), seconds: sweepSeconds(medium), medium,
  });
  emit();
}

/** It came back — or the draft it was filling was thrown away. Either way there is nothing in flight. */
export function clearScan(groupId: string): void {
  if (!scans.delete(groupId)) return;
  emit();
}

/** It was refused. The message stays up until the next scan or the next draft. */
export function failScan(groupId: string, error: string | null): void {
  const live = scans.get(groupId);
  scans.set(groupId, {
    state: "error",
    error,
    startedAt: live?.startedAt ?? Date.now(),
    seconds: live?.seconds ?? 0,
    medium: live?.medium ?? "photo",
  });
  emit();
}

/** Plain read, for code that is not a component. Undefined while nothing has been scanned. */
export function getLiveScan(groupId: string): LiveScan | undefined {
  return scans.get(groupId);
}

/** Reactive read. Undefined while nothing has been scanned. */
export function useLiveScan(groupId: string | undefined): LiveScan | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (groupId ? scans.get(groupId) : undefined),
    () => undefined,
  );
}
