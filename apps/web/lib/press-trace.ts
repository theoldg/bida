"use client";
// Doc: docs/diag.md

import { mark } from "./diag";

/** Records what the phone sent while a menu or dialog was open, for /diag. */

const KINDS = [
  "pointerdown", "pointerup", "pointercancel", "click", "contextmenu",
  "mousedown", "mouseup",
  "touchstart", "touchend", "touchcancel", "scroll", "selectstart", "dragstart",
] as const;

/**
 * Both ends of a long sequence are kept: a flat cap would drop the last tap, the
 * one that worked.
 */
const HEAD = 12;
const TAIL = 26;

interface Trace {
  what: string;
  head: string[];
  tail: string[];
  dropped: number;
  from: number;
  /**
   * Where the open thing was drawn: a card behind a keyboard is out of reach, and
   * no event says so.
   */
  box?: () => string;
  was?: string;
}

let open: Trace | null = null;
let guards = 0;

function kin(el: Element): number {
  return el.parentElement ? [...el.parentElement.children].indexOf(el) : -1;
}

function where(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "?";
  const item = target.closest(".rowmenu-item");
  if (item) return `item${kin(item)}`;
  if (target.closest(".rowmenu")) return "card";
  if (target.closest(".rowmenu-veil")) return "veil";
  // A press down on a button and up on its card is the card having moved — no
  // click is sent.
  const pick = target.closest(".drow-pick");
  if (pick) return `pick${kin(pick)}`;
  const btn = target.closest(".dialog button");
  if (btn) return `btn${kin(btn)}`;
  if (target.closest(".drow")) return "row";
  if (target.closest(".dialog")) return "card";
  if (target instanceof HTMLDialogElement) return "scrim";
  const cls = typeof target.className === "string" ? target.className.split(" ")[0] : "";
  return target.tagName.toLowerCase() + (cls ? `.${cls}` : "");
}

export function note(what: string): void {
  if (!open) return;
  const line = `+${Math.round(performance.now() - open.from)} ${what}`;
  if (open.head.length < HEAD) { open.head.push(line); return; }
  open.tail.push(line);
  if (open.tail.length > TAIL) { open.tail.shift(); open.dropped++; }
}

export function guarding(on: boolean): void {
  guards += on ? 1 : -1;
  note(on ? "guard+" : "guard-");
}

function onAny(e: Event): void {
  if (!open) return;
  // `detail` 0 is a keyboard's click or one the app dispatched.
  const detail = e instanceof MouseEvent ? ` d${e.detail}` : "";
  note(`${e.type}@${where(e.target)}${detail}`);
  if (e.type === "pointerdown" && open.box) {
    const box = open.box();
    if (box && box !== open.was) { open.was = box; note(box); }
  }
}

function listen(on: boolean): void {
  for (const kind of KINDS) {
    // Capture, so it sees a click the guard is about to stop.
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

export function tracePress(what: string, opening: string, box?: () => string): () => void {
  flush();
  const mine: Trace = { what, head: [], tail: [], dropped: 0, from: performance.now(), box };
  open = mine;
  note(`open guards=${guards} ${opening}`);
  listen(true);
  return () => { if (open === mine) flush(); };
}
