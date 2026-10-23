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
 * off it opens nothing and fires nothing: the page never losing focus is the
 * only sign. Android only, because elsewhere the platform says why itself:
 * a desktop shows its file picker, iOS its own permission sheet.
 */
export function watchCamera(input: HTMLInputElement, onStuck: () => void): void {
  if (!/Android/.test(navigator.userAgent)) return;
  const opened = () => { stop(); mark("scan.camera", "opened"); };
  const timer = window.setTimeout(() => {
    stop();
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    mark("scan.camera", "nothing opened");
    onStuck();
  }, GRACE_MS);
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("blur", opened);
    document.removeEventListener("visibilitychange", opened);
    input.removeEventListener("change", opened);
    input.removeEventListener("cancel", opened);
  }
  // Any of these means something took the press: a camera, Android's own
  // permission prompt, or a chooser.
  window.addEventListener("blur", opened);
  document.addEventListener("visibilitychange", opened);
  input.addEventListener("change", opened);
  input.addEventListener("cancel", opened);
}
