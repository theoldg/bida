"use client";

import { useSyncExternalStore } from "react";
import type { ScanMedium } from "@bida/core";

/** Where a scan is: idle, in flight, or refused. */
export type ScanState = "idle" | "scanning" | "error";

/**
 * The scan in flight for a group, or the last one's refusal.
 *
 * It lives out here beside the draft rather than in the component that
 * started it, and for the same reason: a scan is a network round trip to a
 * model, and the screens it can be started from come and go under it. The
 * Items tab is unmounted the moment you tap Evenly, and the form itself is
 * unmounted by the payers editor and the who-had-what grid — none of which
 * says anything about whether a model is still reading a photograph.
 *
 * Holding it in `useState` meant the "Reading…" strip and its bar were facts
 * about a mounted component: leaving the tab and coming back started the
 * sweep again from nothing, on a scan that was two seconds old.
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
 * How long one sweep lasts: three seconds for a photo, two for a typed bill,
 * both jittered. Drawn once per *scan*, so a second scan doesn't repeat the
 * first to the frame — which is what makes a bar read as a canned animation
 * rather than an estimate. Per scan and not per mount: a bar that redrew its
 * own guess on the way back would be a different estimate of the same wait.
 *
 * It was two, which is what a scan used to take. It no longer is: the round
 * trip now carries a Turnstile challenge as well as the model, and the
 * upstream API is slower under load than it was. A bar that fills early and
 * then hands over to a spinner is the one failure this control has — it
 * promises an answer and then admits it was guessing — so the estimate tracks
 * the scan rather than the other way round.
 *
 * A typed bill is shorter for the reasons it is: no photo to resize and no
 * 200 KB to push, so what is left is the challenge, two D1 round trips and the
 * model. The same estimate for both would be a bar that finished a second early
 * every time somebody typed.
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
