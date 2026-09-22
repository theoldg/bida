"use client";

import { useState } from "react";
import { copy } from "../lib/copy";
import type { LiveScan } from "../lib/scan/live";

/**
 * How a reading in flight is drawn. Its own file because the scan control and
 * the type-a-bill dialog both use it, and the control renders that dialog —
 * beside the control it would be a cycle.
 */

/**
 * The wash sweeping across the control while the model reads, at the pace a
 * scan usually takes; `onFull` hands over to a spinner if this one is slower.
 * It promises the *usual* scan, so it is `aria-hidden` — screen readers get
 * the "Reading…" beside it.
 *
 * - The duration is inline: a different number every sweep.
 * - The **negative** delay makes it a clock on the scan, not itself, so a bar
 *   remounted a second into a scan starts a second in.
 * - **`animationend` must be stopped** — `.btn-pair` listens for the refusal
 *   flash's end (`onFlashEnd`) and would take a loose one for it.
 */
function ScanBar({ startedAt, seconds, onFull }: {
  startedAt: number;
  seconds: number;
  onFull: () => void;
}) {
  // Read once, at mount: the offset is where this sweep starts, not something
  // that moves under it while it runs.
  const [elapsed] = useState(() => (Date.now() - startedAt) / 1000);
  return (
    <span className="scanbar" aria-hidden="true"
      style={{ animationDuration: `${seconds}s`, animationDelay: `${-elapsed}s` }}
      onAnimationEnd={(e) => { e.stopPropagation(); onFull(); }} />
  );
}

/**
 * "Reading…", with the bar sweeping across it, wherever a reading is in flight.
 * **Shared, never copied**: the Items tab and the type-a-bill dialog watch one
 * `LiveScan`, and two implementations would be two estimates of one wait.
 * `box` is the caller's class, for placement.
 */
export function ScanBusy({ live, box, button = "btn", onFlashEnd }: {
  live: LiveScan;
  box: string;
  /** The register's own class for the strip inside — `btn btn-lg` on `/g/scan`. */
  button?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
}) {
  /**
   * The sweep ran out with the scan still going, so the spinner takes over;
   * reset when the scan ends. **Two ways to be past it**, since this can mount
   * mid-scan: the sweep ended under us (`setFull`), or before we rendered — a
   * bar starting beyond its end never fires `animationend`.
   */
  const [full, setFull] = useState(false);
  const overrun = Date.now() - live.startedAt >= live.seconds * 1000;
  const spinning = full || overrun;
  // One element, so the box keeps the height it had and nothing under it moves
  // while the model reads. Disabled through the same `.btn:disabled` every
  // other spent button in the app uses.
  return (
    <div className={`${box} pair-busy`} onAnimationEnd={onFlashEnd}>
      {spinning ? null : (
        <ScanBar startedAt={live.startedAt} seconds={live.seconds}
          onFull={() => setFull(true)} />
      )}
      <button type="button" className={button} disabled aria-live="polite">
        {spinning ? <span className="spinner" aria-hidden="true" /> : null}
        {copy.scan.reading}
      </button>
    </div>
  );
}
