"use client";

import { mark } from "./diag";

/**
 * What the phone sent while something was open over the screen.
 *
 * A menu that answers only every other press, a dialog that refuses a run of
 * taps — bugs no browser on a build machine reproduces: they want a phone, and
 * by the time one is in reach the press is over and there is nothing to look
 * at. Every explanation for one is a different line in the same short sequence
 * — a `click` that never came, one swallowed by a hold's own guard
 * (`components/long-press.tsx`), one landing on the veil or the scrim instead
 * of the item, a `pointercancel` where a lift should be, a card that moved
 * between the press and the lift so the two had no target in common and the
 * browser sent no click at all — and they are told apart by reading the
 * sequence, not by arguing about it. So the recorder takes it, and /diag has it
 * the next time somebody says they were ignored.
 *
 * It has already earned itself once: the answer was a tap that landed whole on
 * a menu item and brought no click, which is why the items no longer wait for
 * one (components/row-menu.tsx). Every reading of that press by hand was wrong.
 *
 * Only while something is open, which is seldom and briefly: a capped array and
 * a `performance.now()` per event, formatted only when the report asks.
 * `pointermove` is left out — it is the one that would flood this.
 */

/**
 * Everything a press can be made of, minus the one that repeats.
 *
 * The compatibility mouse pair is in here because leaving it out cost a
 * release: a press answered on the lift was recorded as clean, and the
 * `mousedown` that undid it arrived after the card — and so the recorder —
 * had gone (components/row-menu.tsx).
 */
const KINDS = [
  "pointerdown", "pointerup", "pointercancel", "click", "contextmenu",
  "mousedown", "mouseup",
  "touchstart", "touchend", "touchcancel", "scroll", "selectstart", "dragstart",
] as const;

/**
 * How much of a long sequence is kept, and **which parts**.
 *
 * One flat cap was enough for a row menu, which is open for a single press and
 * answers it. It is the wrong shape for a dialog that refuses a run of taps:
 * that is open for seconds, spends six or seven events on every tap, and a cap
 * that stops the line growing throws away the taps the report is about — the
 * last one, which worked, and whatever was different about it.
 *
 * So both ends are kept. The head holds the opening and the first press that
 * went wrong; the tail holds the run that ended it. What fell out between them
 * is counted, and the count is itself a reading: it says how many taps this
 * took.
 */
const HEAD = 12;
const TAIL = 26;

/** One thing open over the screen, and what has happened under it so far. */
interface Trace {
  /** The mark it is written as: `menu.trace`, `dialog.trace`. */
  what: string;
  head: string[];
  tail: string[];
  /** Steps that fell out of the middle, which is a count of taps, roughly. */
  dropped: number;
  from: number;
  /**
   * Where the thing that is open was drawn, asked at each press.
   *
   * **The one question a refused tap asks that no event answers**: a card
   * centred in a layout viewport with a keyboard over the bottom half of it is
   * drawn where the finger cannot reach, and every event says only that the
   * press never arrived. Read at `pointerdown`, which is a handful of times per
   * trace and never while nothing is open, and **written only when it has
   * changed**: the same four numbers under every tap of a run is the noise that
   * hides the one tap they were different for, which is the whole answer.
   */
  box?: () => string;
  /** The last reading, so an unchanged one costs nothing but the read. */
  was?: string;
}

let open: Trace | null = null;
/** Hold guards currently armed, so a swallow has something to be blamed on. */
let guards = 0;

/** Where in the parent's row of children, which is how an item names itself. */
function kin(el: Element): number {
  return el.parentElement ? [...el.parentElement.children].indexOf(el) : -1;
}

/** Which part of what is open an event landed on, in as few characters as say it. */
function where(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "?";
  const item = target.closest(".rowmenu-item");
  if (item) return `item${kin(item)}`;
  if (target.closest(".rowmenu")) return "card";
  if (target.closest(".rowmenu-veil")) return "veil";
  // A dialog's own parts. **The buttons are named apart from the card they sit
  // in**, because that is the whole question a refused tap asks: a press that
  // goes down on `btn1` and lifts on `card` is the card having moved out from
  // under the finger, and the browser sends no click for it.
  const pick = target.closest(".drow-pick");
  if (pick) return `pick${kin(pick)}`;
  const btn = target.closest(".dialog button");
  if (btn) return `btn${kin(btn)}`;
  // **A disabled button takes no pointer events at all**, so a press aimed at
  // one lands on the row holding it. That has to read differently from the
  // card's body, or "it ignored my tap" and "there was nothing there to tap"
  // are the same line.
  if (target.closest(".drow")) return "row";
  if (target.closest(".dialog")) return "card";
  if (target instanceof HTMLDialogElement) return "scrim";
  const cls = typeof target.className === "string" ? target.className.split(" ")[0] : "";
  return target.tagName.toLowerCase() + (cls ? `.${cls}` : "");
}

/** Add a line of our own — something the app did, rather than was told. */
export function note(what: string): void {
  if (!open) return;
  const line = `+${Math.round(performance.now() - open.from)} ${what}`;
  if (open.head.length < HEAD) { open.head.push(line); return; }
  open.tail.push(line);
  if (open.tail.length > TAIL) { open.tail.shift(); open.dropped++; }
}

/** A hold's guard went up or came down (`components/long-press.tsx`). */
export function guarding(on: boolean): void {
  guards += on ? 1 : -1;
  note(on ? "guard+" : "guard-");
}

function onAny(e: Event): void {
  if (!open) return;
  // `detail` is how a click says whether a finger made it: 0 is a keyboard's,
  // or one the app dispatched itself, and the guard lets those through.
  const detail = e instanceof MouseEvent ? ` d${e.detail}` : "";
  note(`${e.type}@${where(e.target)}${detail}`);
  // Only on the way down: the answer is where the card was when the finger
  // landed, not where it had got to by the lift. Said once, and then again only
  // if it moved — a card that moved mid-run is what this is looking for.
  if (e.type === "pointerdown" && open.box) {
    const box = open.box();
    if (box && box !== open.was) { open.was = box; note(box); }
  }
}

function listen(on: boolean): void {
  for (const kind of KINDS) {
    // Passive: this only watches. Capture, so it sees an event the guard is
    // about to stop — `stopPropagation` does not reach another listener on the
    // same target, which is what makes a swallowed click visible here at all.
    if (on) document.addEventListener(kind, onAny, { capture: true, passive: true });
    else document.removeEventListener(kind, onAny, { capture: true });
  }
}

function flush(): void {
  if (!open) return;
  const { what, head, tail, dropped } = open;
  open = null;
  listen(false);
  const middle = dropped ? [`…${dropped} more…`] : [];
  mark(what, [...head, ...middle, ...tail].join("  ") || "nothing happened");
}

/**
 * Record until this thing goes away. Returns the stop, so a component can hand
 * it straight back from an effect.
 *
 * Only one at a time — a menu whose item opens a dialog hands over rather than
 * sharing, and the handover is where the menu's line ends. The stop is checked
 * against what it started, so the menu unmounting a beat later cannot cut the
 * dialog's trace short.
 *
 * `box` is asked at each press for where the thing is drawn; leave it out and
 * the trace is events alone.
 */
export function tracePress(what: string, opening: string, box?: () => string): () => void {
  flush();
  const mine: Trace = { what, head: [], tail: [], dropped: 0, from: performance.now(), box };
  open = mine;
  note(`open guards=${guards} ${opening}`);
  listen(true);
  return () => { if (open === mine) flush(); };
}
