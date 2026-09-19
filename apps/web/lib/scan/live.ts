"use client";

import { useSyncExternalStore } from "react";
import type { ScanMedium } from "@bida/core";

/** Where a scan is: idle, in flight, or refused. */
export type ScanState = "idle" | "scanning" | "error";

/**
 * The scan in flight for a group, or the last one's refusal.
 *
 * **Never hold this in a component's `useState`.** A scan is a network round
 * trip to a model, and the screens it can be started from come and go under
 * it: the Items tab is unmounted the moment you tap Evenly, and the form
 * itself by the payers editor and the who-had-what grid. In state, leaving a
 * tab and coming back restarts the "Reading…" sweep from nothing on a scan
 * that is two seconds old.
 */
export interface LiveScan {
  state: Exclude<ScanState, "idle">;
  /** Why the last scan failed, already worded for a person. Null falls back to the generic message. */
  error: string | null;
  /**
   * When the scan began. The progress bar is drawn from this rather than from
   * its own mount, so a bar that comes back resumes where the scan actually is.
   */
  startedAt: number;
  /** The sweep this scan was given, in seconds — see `sweepSeconds`. */
  seconds: number;
  /**
   * Whether this reading is of a photograph or of a bill somebody typed. The
   * bar's pace comes off it, and so does which words a refusal is said in:
   * "try a flatter, square-on photo" is nonsense advice about typing.
   */
  medium: ScanMedium;
}

/**
 * How long one sweep lasts: three seconds for a photo, two for a typed bill
 * (no photo to resize and no 200 KB to push), both jittered.
 *
 * **Drawn once per scan, never per mount.** Per scan, so a second scan doesn't
 * repeat the first to the frame and read as a canned animation; not per mount,
 * or a bar coming back would give a different estimate of the same wait.
 *
 * Keep the estimate tracking what a scan actually costs — the round trip
 * carries a Turnstile challenge and two D1 round trips as well as the model. A
 * bar that fills early and hands over to a spinner is this control's one
 * failure: it promises an answer and then admits it was guessing.
 */
function sweepSeconds(medium: ScanMedium): number {
  return medium === "text" ? 1.8 + Math.random() * 0.4 : 2.8 + Math.random() * 0.4;
}

const scans = new Map<string, LiveScan>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

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
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    () => (groupId ? scans.get(groupId) : undefined),
    () => undefined,
  );
}
