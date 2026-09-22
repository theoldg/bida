"use client";

import { mark } from "./diag";

/**
 * What the phone sent while something was open over the screen.
 *
 * A menu answering every other press, a dialog refusing a run of taps: bugs
 * only a phone reproduces, over before anyone can look. The explanations are
 * all different lines in one short sequence — a `click` that never came, one
 * swallowed by a hold's guard (`components/long-press.tsx`), one landing on
 * the veil or scrim, a `pointercancel` for a lift, a card that moved between
 * press and lift so the browser sent no click — and reading the sequence
 * tells them apart. So it is recorded for /diag.
 *
 * Only while something is open: a capped array and a `performance.now()` per
 * event. `pointermove` is left out — it would flood this.
 */

/**
 * Everything a press can be made of, minus the one that repeats. The
 * compatibility mouse events are in: a press answered on the lift can be undone
 * by a later `mousedown` (components/row-menu.tsx).
 */
const KINDS = [
  "pointerdown", "pointerup", "pointercancel", "click", "contextmenu",
  "mousedown", "mouseup",
  "touchstart", "touchend", "touchcancel", "scroll", "selectstart", "dragstart",
] as const;

/**
 * How much of a long sequence is kept, and **which parts**: both ends. A
 * dialog refusing a run of taps is open for seconds at six or seven events a
 * tap, and a flat cap would drop the last tap — the one that worked. The head
 * holds the opening and the first bad press, the tail the run that ended it,
 * and the count dropped between says how many taps it took.
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
   * Where the open thing was drawn, asked at each `pointerdown`. **The one
   * question a refused tap asks that no event answers**: a card centred behind a
   * keyboard is out of the finger's reach, and every event just says the press
   * never arrived. **Written only when it changed**, so the one tap it differed
   * for stands out.
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
  // **Buttons are named apart from their card**: a press down on `btn1` and up
  // on `card` is the card having moved under the finger — no click is sent.
  const pick = target.closest(".drow-pick");
  if (pick) return `pick${kin(pick)}`;
  const btn = target.closest(".dialog button");
  if (btn) return `btn${kin(btn)}`;
  // **A disabled button takes no pointer events**, so a press aimed at one
  // lands on its row — which must read differently from the card's body.
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
 * Record until this thing goes away; returns the stop, for an effect.
 *
 * One at a time — a menu whose item opens a dialog hands over, ending the
 * menu's line. The stop checks what it started, so the menu unmounting a beat
 * later can't cut the dialog's trace short. `box` is optional.
 */
export function tracePress(what: string, opening: string, box?: () => string): () => void {
  flush();
  const mine: Trace = { what, head: [], tail: [], dropped: 0, from: performance.now(), box };
  open = mine;
  note(`open guards=${guards} ${opening}`);
  listen(true);
  return () => { if (open === mine) flush(); };
}
