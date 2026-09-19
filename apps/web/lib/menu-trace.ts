"use client";

import { mark } from "./diag";

/**
 * What the phone sent while a row menu was open.
 *
 * A menu that answers only every other press is a bug no browser on a build
 * machine reproduces: it wants an iPhone, and by the time one is in reach the
 * press is over and there is nothing to look at. Every explanation for it is a
 * different line in the same short sequence — a `click` that never came, one
 * swallowed by the hold's own guard (`components/long-press.tsx`), one landing
 * on the veil instead of the item, a `pointercancel` where a lift should be —
 * and they are told apart by reading the sequence, not by arguing about it. So
 * the recorder takes it, and /diag has it the next time somebody says the menu
 * ignored them.
 *
 * Only while a card is open, which is seldom and briefly: a capped array and a
 * `performance.now()` per event, formatted only when the report asks.
 * `pointermove` is left out — it is the one that would flood this.
 */

/** Everything a press can be made of, minus the one that repeats. */
const KINDS = [
  "pointerdown", "pointerup", "pointercancel", "click", "contextmenu",
  "touchstart", "touchend", "touchcancel", "scroll", "selectstart", "dragstart",
] as const;

/**
 * Long enough for a press that failed and the one that worked after it. Past
 * this the line stops growing rather than the mark growing unbounded — the
 * answer is in the first few either way.
 */
const LIMIT = 30;

let steps: string[] | null = null;
let from = 0;
/** Hold guards currently armed, so a swallow has something to be blamed on. */
let guards = 0;

/** Which part of the menu an event landed on, in as few characters as say it. */
function where(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "?";
  const item = target.closest(".rowmenu-item");
  if (item) {
    const kin = item.parentElement ? [...item.parentElement.children] : [];
    return `item${kin.indexOf(item)}`;
  }
  if (target.closest(".rowmenu")) return "card";
  if (target.closest(".rowmenu-veil")) return "veil";
  const cls = typeof target.className === "string" ? target.className.split(" ")[0] : "";
  return target.tagName.toLowerCase() + (cls ? `.${cls}` : "");
}

/** Add a line of our own — something the app did, rather than was told. */
export function note(what: string): void {
  if (!steps || steps.length >= LIMIT) return;
  steps.push(`+${Math.round(performance.now() - from)} ${what}`);
}

/** A hold's guard went up or came down (`components/long-press.tsx`). */
export function guarding(on: boolean): void {
  guards += on ? 1 : -1;
  note(on ? "guard+" : "guard-");
}

function onAny(e: Event): void {
  if (!steps || steps.length >= LIMIT) return;
  // `detail` is how a click says whether a finger made it: 0 is a keyboard's,
  // or one the app dispatched itself, and the guard lets those through.
  const detail = e instanceof MouseEvent ? ` d${e.detail}` : "";
  note(`${e.type}@${where(e.target)}${detail}`);
}

/**
 * Record until the card goes away. Returns the stop, so a component can hand
 * it straight back from an effect.
 */
export function traceMenu(items: number): () => void {
  steps = [];
  from = performance.now();
  note(`open guards=${guards} items=${items}`);
  // Passive: this only watches. Capture, so it sees an event the guard is
  // about to stop — `stopPropagation` does not reach another listener on the
  // same target, which is what makes a swallowed click visible here at all.
  for (const kind of KINDS) {
    document.addEventListener(kind, onAny, { capture: true, passive: true });
  }
  return () => {
    for (const kind of KINDS) {
      document.removeEventListener(kind, onAny, { capture: true });
    }
    const line = steps?.join("  ") ?? "";
    steps = null;
    mark("menu.trace", line || "nothing happened");
  };
}
