"use client";

import { useEffect } from "react";
import { mark } from "../lib/diag";
import { note } from "../lib/press-trace";
import { confirmAct, gapOf, isTyping, landsOn, reachOf } from "../lib/viewport";

/**
 * Bring a field into view, and whatever it says has to come up with it.
 *
 * `nearest` covers an ordinary field. The add row also needs room for the act
 * below it, declared as `scroll-margin-bottom` (`--act-below`, globals.css) —
 * which the browser skips when it thinks the field is already in view, exactly
 * the keyboard case. The remainder is paid here (`reachOf`).
 *
 * Shared by name-adder.tsx, `follow` below, and on top of the browser's own
 * scroll on focus.
 */
export function bringIntoView(el: Element) {
  el.scrollIntoView({ block: "nearest" });
  const room = parseFloat(getComputedStyle(el).scrollMarginBottom);
  if (!room) return;
  const box = el.closest(".scroll");
  if (!box) return;
  const stop = box.getBoundingClientRect().bottom
    - (parseFloat(getComputedStyle(box).scrollPaddingBottom) || 0);
  box.scrollTop += reachOf({ bottom: el.getBoundingClientRect().bottom, room, stop });
}

/**
 * **The one place the visual viewport is measured**: how much the keyboard
 * covers, as `--kb`, and a layout viewport taller than the screen — a browser
 * bug, recorded rather than paid for (lib/viewport.ts).
 *
 * On iOS the keyboard and its accessory bar overlay the `100dvh` shell rather
 * than shortening it, so `.scroll` ends behind them. `.scroll` spends the
 * covered strip as trailing space and `scroll-padding-bottom`, so every scroll
 * stops short of the keyboard.
 *
 * **Set on `<html>`, not the shell**: dialogs and the FAB live outside it and
 * need the same value.
 */
export function MeasureViewport() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let frame = 0;
    let reported = 0;
    let paid = 0;

    function measure() {
      if (!view) return;
      const { kb, unexplained } = gapOf({
        inner: window.innerHeight, visible: view.height, offset: view.offsetTop,
        scale: view.scale, typing: isTyping(document.activeElement),
      });
      root.style.setProperty("--kb", `${kb}px`);
      // A dialog's card is centred in what the keyboard leaves, so each step
      // moves it — and a card moving between press and lift gets no click.
      // Traced only while an overlay is open (lib/press-trace.ts).
      if (kb !== paid) { note(`kb ${paid}->${kb}`); paid = kb; }
      // Whether there is a keyboard at all is this component's to know; how
      // much air to leave above one is the stylesheet's (`--kb-gap`).
      root.toggleAttribute("data-kb", kb > 0);
      // A gap with nobody typing is a screen shorter than the layout: the last
      // strip of every screen is unreachable. Nothing can give those pixels back,
      // so record it for /diag.
      if (unexplained !== reported) {
        reported = unexplained;
        mark("viewport.gap", unexplained
          ? `${unexplained}px of the layout viewport is off screen — `
            + `inner ${Math.round(window.innerHeight)}, visible ${Math.round(view.height)}`
            + `+${Math.round(view.offsetTop)}`
          : "gone");
      }
    }

    /**
     * The keyboard opening is the one moment worth re-scrolling for: the browser
     * already put the field against the accessory bar, before `--kb` existed.
     * A dialog is followed too — its card is centred in what the keyboard leaves,
     * and a tall one scrolls inside itself. **One `bringIntoView` call for every
     * field.**
     */
    function follow() {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".scroll, .dialog")) {
        bringIntoView(focused);
      }
    }

    function onResize() {
      cancelAnimationFrame(frame);
      // One frame late, so the scroll reads the padding this measurement pays
      // for rather than the previous one.
      frame = requestAnimationFrame(() => { measure(); requestAnimationFrame(follow); });
    }

    measure();
    view.addEventListener("resize", onResize);
    // Panning the visual viewport changes what is covered without resizing it,
    // but it is the reader's own scroll — measure, never move them.
    view.addEventListener("scroll", measure);
    // Who has the caret decides whether a gap is a keyboard at all, and focus
    // moves without the viewport doing anything: a field blurred while the
    // keyboard is still sliding away owes nothing from the moment it is left.
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

/**
 * The confirm key, walking a screen's fields and folding the keyboard at the
 * end of them.
 *
 * On `.scroll`, not on each field: the next field is rarely a sibling (the
 * box below, the next member's row), and screen order is thumb order.
 *
 * **`enterKeyHint="next"` hands the caret on; every other field ends its chain
 * and folds the keyboard** (`confirmAct`) — so the entry form's note says
 * "done" rather than diving into the split editor, whose last row does the
 * same rather than wrapping round.
 *
 * **A field inside a `<form>` is left alone**: its Enter already files a name
 * or submits a card.
 *
 * The caret goes to the *end* of the field it lands in: at character nought a
 * typed "5" turns "12.00" into "512.00".
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
  const next = act === "next" ? after(from, e.currentTarget) : null;
  // Folding is the field being put down: the keyboard goes with the caret.
  if (!next) { from.blur(); return; }
  next.focus();
  // Guarded: `setSelectionRange` throws on the input types that have no caret
  // to place, and one of those is a field away from being added here.
  try { next.setSelectionRange(next.value.length, next.value.length); } catch { /* no caret */ }
  bringIntoView(next);
}

/** The field after this one on the screen, or null at the end of them. */
function after(from: Field, scope: HTMLElement): Field | null {
  const fields = [...scope.querySelectorAll("input, textarea")].filter(walkable);
  return fields[fields.indexOf(from) + 1] ?? null;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Whether the caret can be in this one at all (`landsOn`, lib/viewport.ts). */
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
