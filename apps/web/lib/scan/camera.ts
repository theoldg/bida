// Doc: docs/receipt-scanning.md#gotchas
import { mark } from "../diag";

/**
 * How long a camera may take to cover the page. A cold camera app is well
 * under this; past it, nothing is coming.
 */
const GRACE_MS = 2000;

/**
 * Calls `onStuck` when a press on the camera input opened nothing. Android
 * hands `capture` to the camera app, and with Chrome's own camera permission
 * off it opens nothing: at most a `cancel` at once, before the page ever lost
 * focus — a person's cancel comes back from a camera that covered it. Android
 * only, because elsewhere the platform says why itself: a desktop shows its
 * file picker, iOS its own permission sheet.
 */
export function watchCamera(input: HTMLInputElement, onStuck: () => void): void {
  if (!/Android/.test(navigator.userAgent)) return;
  const opened = () => { stop(); mark("scan.camera", "opened"); };
  const stuck = () => {
    stop();
    if (document.visibilityState !== "visible") return;
    mark("scan.camera", "nothing opened");
    onStuck();
  };
  const timer = window.setTimeout(stuck, GRACE_MS);
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("blur", opened);
    document.removeEventListener("visibilitychange", opened);
    input.removeEventListener("change", opened);
    input.removeEventListener("cancel", stuck);
  }
  // Any of these means something took the press: a camera, Android's own
  // permission prompt, or a chooser.
  window.addEventListener("blur", opened);
  document.addEventListener("visibilitychange", opened);
  input.addEventListener("change", opened);
  input.addEventListener("cancel", stuck);
}
