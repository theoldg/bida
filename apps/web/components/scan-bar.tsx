"use client";

import { useState } from "react";
import { copy } from "../lib/copy";
import type { LiveScan } from "../lib/scan/live";

/**
 * How a reading in flight is drawn, wherever it is drawn.
 *
 * Its own file because two things wear it — the control on every scanning
 * screen, and the dialog a bill is typed into — and the control is what renders
 * that dialog, so leaving these beside it would be a cycle.
 */

/**
 * The wash sweeping across the control while the model reads.
 *
 * A scan is about three seconds of network, challenge and model — long enough
 * that a spinner alone says only "no idea" — so the control fills at the pace
 * a scan usually takes, and `onFull` hands over to the spinner if this one is
 * slower. The bar promises the *usual* scan and not this one, which is why it is
 * `aria-hidden`: what a screen reader is owed is the "Reading…" beside it.
 *
 * Three details it cannot do without. The duration is inline, being a different
 * number every sweep while the class holds only the shape. The **negative**
 * delay makes the bar a clock on the scan rather than on itself: one mounting
 * onto a scan already a second old starts a second in, so leaving the Items tab
 * and coming back resumes the sweep. And **`animationend` must be stopped** —
 * `.btn-pair` listens on the way up for the refusal flash (`onFlashEnd`), and
 * reads a loose one as a flash that has settled.
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
 * "Reading…", with the bar sweeping across it — what every surface that starts
 * a reading shows while one is in flight.
 *
 * **Shared, never copied**: it is a clock on the *scan*, not on whatever draws
 * it, and the Items tab's pair and the type-a-bill dialog both watch one
 * `LiveScan` — two implementations would be two estimates of one wait. `box` is
 * the caller's own class, since the strip is the same and where it sits is not.
 */
export function ScanBusy({ live, box, button = "btn", onFlashEnd }: {
  live: LiveScan;
  box: string;
  /** The register's own class for the strip inside — `btn btn-lg` on `/g/scan`. */
  button?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
}) {
  /**
   * The sweep has run out and the scan is still going, so the spinner takes
   * over. Reset the moment the scan ends — the next is a fresh sweep of its own.
   *
   * **Two ways to be past it**, because this control can mount onto a scan
   * already in flight: the sweep finished under us (`setFull`), or it finished
   * before we rendered at all — a bar starting beyond its own end never fires
   * `animationend`.
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
