"use client";

import { useEffect } from "react";
import { mark } from "../lib/diag";
import { note } from "../lib/press-trace";
import { caretOnPress, confirmAct, gapOf, isTyping, landsOn } from "../lib/viewport";

/** `nearest`, so a field already in view stays put. */
export function bringIntoView(el: Element) {
  el.scrollIntoView({ block: "nearest" });
}

/**
 * The one place the keyboard is measured: how much of the screen it covers,
 * as `--kb` on `<html>` (dialogs and the FAB live outside the shell), and
 * whether one is up at all, as `data-kb`.
 *
 * On iOS the keyboard overlays the `100dvh` shell rather than shortening it,
 * so `.scroll` and `.whodock` pay the covered strip as padding themselves. On
 * Android the page is shrunk for it and `--kb` stays 0 (lib/viewport.ts).
 */
export function MeasureViewport() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let frame = 0;
    let reportedGap = 0;
    let lastKb = 0;
    // The layout viewport with no keys taken off it, per width: a turned phone
    // starts again.
    let width = window.innerWidth;
    let tallest = window.innerHeight;

    function measure() {
      if (!view) return;
      if (window.innerWidth !== width) { width = window.innerWidth; tallest = 0; }
      tallest = Math.max(tallest, window.innerHeight);
      const { kb, unexplained, up } = gapOf({
        inner: window.innerHeight, visible: view.height, offset: view.offsetTop,
        scale: view.scale, typing: isTyping(document.activeElement), tallest,
      });
      root.style.setProperty("--kb", `${kb}px`);
      // A dialog centred in what the keyboard leaves moves with each step, and
      // a card moving between press and lift gets no click (lib/press-trace.ts).
      if (kb !== lastKb) { note(`kb ${lastKb}->${kb}`); lastKb = kb; }
      if (up !== root.hasAttribute("data-kb")) {
        // With the readings it came from: a keyboard misread on one browser is
        // only ever diagnosed from that phone's /diag.
        mark("viewport.kb", `${up ? "up" : "down"}, ${kb}px paid — inner ${Math.round(window.innerHeight)}`
          + ` of ${Math.round(tallest)}, visible ${Math.round(view.height)}+${Math.round(view.offsetTop)}`);
      }
      root.toggleAttribute("data-kb", up);
      // A gap with nobody typing is a browser bug that hides the bottom strip of
      // every screen. Nothing can give those pixels back, so record it for /diag.
      if (unexplained !== reportedGap) {
        reportedGap = unexplained;
        mark("viewport.gap", unexplained
          ? `${unexplained}px of the layout viewport is off screen — `
            + `inner ${Math.round(window.innerHeight)}, visible ${Math.round(view.height)}`
            + `+${Math.round(view.offsetTop)}`
          : "gone");
      }
    }

    // The browser placed the field against the keyboard before `--kb` existed,
    // or before Android's shrunk page had laid out.
    function followFocusedField() {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".scroll, .dialog")) {
        bringIntoView(focused);
      }
    }

    function onResize() {
      cancelAnimationFrame(frame);
      // A frame late, so the scroll reads the padding this measurement sets.
      frame = requestAnimationFrame(() => { measure(); requestAnimationFrame(followFocusedField); });
    }

    measure();
    view.addEventListener("resize", onResize);
    // Panning is the reader's own scroll: measure, never move them.
    view.addEventListener("scroll", measure);
    // Who has the caret decides whether a gap is a keyboard, and focus moves
    // without the viewport changing.
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener("resize", onResize);
      view.removeEventListener("scroll", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
      root.style.removeProperty("--kb");
      root.removeAttribute("data-kb");
    };
  }, []);
  return null;
}

/** A field is not one: pressing it moves the caret. */
const PRESSABLE = "button, a[href], [role=button], [role=option], [role=menuitem], [role=tab]";

/**
 * A pointer press while a keyboard is up keeps the field's focus, for every
 * pressable in the app. Otherwise `mousedown` blurs the field, the keyboard
 * retracts, the page reflows, and the `click` lands where the button no longer
 * is. Capture phase, so no handler can opt a button out.
 *
 * Android's back closes the keyboard but leaves the caret, and holding focus
 * then makes Chrome reopen it — so that case blurs instead (`caretOnPress`).
 */
export function HoldCaret() {
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!(e.target instanceof Element) || !e.target.closest(PRESSABLE)) return;
      const focused = document.activeElement;
      switch (caretOnPress(document.documentElement.hasAttribute("data-kb"), isTyping(focused))) {
        case "hold": e.preventDefault(); break;
        case "blur": if (focused instanceof HTMLElement) focused.blur(); break;
        case "free": break;
      }
    }
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, []);
  return null;
}

/**
 * The confirm key on `.scroll`: `enterKeyHint="next"` hands the caret to the
 * next field in screen order; any other hint folds the keyboard. Fields inside
 * a `<form>` keep their own Enter.
 */
export function walkFields(e: React.KeyboardEvent<HTMLElement>) {
  const from = e.target;
  if (!walkable(from) || from.closest("form")) return;
  const act = confirmAct({
    key: e.key, hint: from.enterKeyHint, isComposing: e.nativeEvent.isComposing,
    altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
  });
  if (act === "none") return;
  e.preventDefault();
  const next = act === "next" ? fieldAfter(from, e.currentTarget) : null;
  if (!next) { from.blur(); return; }
  next.focus();
  // Caret at the end: at character nought a typed "5" turns "12.00" into "512.00".
  // `setSelectionRange` throws on input types with no caret.
  try { next.setSelectionRange(next.value.length, next.value.length); } catch { /* no caret */ }
  bringIntoView(next);
}

type Field = HTMLInputElement | HTMLTextAreaElement;

function fieldAfter(from: Field, scope: HTMLElement): Field | null {
  const fields = [...scope.querySelectorAll("input, textarea")].filter(walkable);
  return fields[fields.indexOf(from) + 1] ?? null;
}

function walkable(el: EventTarget | null): el is Field {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  return landsOn({
    typing: isTyping(el),
    type: el instanceof HTMLInputElement ? el.type : "textarea",
    disabled: el.disabled,
    readOnly: el.readOnly,
    drawn: el.getClientRects().length > 0,
  });
}
