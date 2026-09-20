"use client";

import { useEffect } from "react";
import { mark } from "../lib/diag";
import { note } from "../lib/press-trace";
import { confirmAct, gapOf, isTyping, landsOn, reachOf } from "../lib/viewport";

/**
 * Bring a field into view, and whatever it says has to come up with it.
 *
 * `nearest` scrolls the least that works, which is the whole answer for an
 * ordinary field and most of it for the add row — where the act the list ends
 * on sits underneath, on the scroll rather than in a pinned foot. A field says
 * how much room that act needs in `scroll-margin-bottom` (`--act-below`,
 * globals.css); the browser spends it when it has to scroll anyway and skips it
 * when it decides the field is already in view, which is exactly the case a
 * keyboard makes — so the remainder is paid here (`reachOf`).
 *
 * The one scroll every path shares: ours when a name is filed
 * (name-adder.tsx), ours when the keyboard opens (`follow` below), and the
 * browser's own on focus, which this one lands on top of.
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
 * **The one place the visual viewport is measured**, and the two things that
 * fall out of it: how much of the app the on-screen keyboard covers, as `--kb`,
 * and a layout viewport taller than the screen, which is a browser bug and is
 * recorded rather than paid for (lib/viewport.ts).
 *
 * The shell is `100dvh` and never scrolls (globals.css), which is right until a
 * keyboard opens: on iOS it and its accessory bar — suggestion strip, "Done"
 * and arrows — are drawn *over* the layout viewport rather than shortening it,
 * so `dvh` doesn't move and `.scroll`'s bottom edge sits behind the keyboard.
 * Scrolling a field into view lands it exactly there.
 *
 * `.scroll` spends the covered strip as real space at the end of the list and
 * as `scroll-padding-bottom`, so every scroll — ours and the browser's own on
 * focus — stops short of the keyboard instead of under it.
 *
 * **Set on `<html>`, not the shell**: dialogs and the FAB live outside it and
 * need the same value, so a card asking for a number is centred above the
 * keyboard rather than behind it.
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
      // A dialog's card is centred in what the keyboard leaves, so every step
      // of this moves it — and a card that moves between a press and its lift
      // is a tap the browser sends no click for. Only while something is open
      // over the screen; the rest of the time this writes nothing
      // (lib/press-trace.ts).
      if (kb !== paid) { note(`kb ${paid}->${kb}`); paid = kb; }
      // Whether there is a keyboard at all is this component's to know; how
      // much air to leave above one is the stylesheet's (`--kb-gap`).
      root.toggleAttribute("data-kb", kb > 0);
      // A gap with nobody typing is the app painted on a screen shorter than
      // the one it was laid out for: the last strip of every screen — bottom
      // nav, about line — is below the fold in a shell that cannot scroll.
      // Nothing here can give those pixels back, so record it and /diag has the
      // number next time somebody says the tabs went missing.
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
     * has already put the field flush against the accessory bar, and it did that
     * before `--kb` existed.
     *
     * A dialog is the other scroller worth following into: its card is centred
     * in what the keyboard leaves (globals.css), and one taller than that
     * scrolls inside itself.
     *
     * A field needing more than itself in view says so in `scroll-margin-bottom`
     * and `bringIntoView` spends it — **one call for every field either way**.
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
 * Hung on `.scroll` rather than on each field, because the next field is
 * rarely a sibling of the one being left: on the entry form it is the box
 * below, and in the split editor it is the next member's row. The screen is
 * the scope, so the order is the one a thumb meets them in and a field added
 * between two others needs nothing said here.
 *
 * **A field wearing `enterKeyHint="next"` hands the caret on; every other
 * field is the end of its chain and folds the keyboard** (`confirmAct`). That
 * is what makes a column of figures a chain of its own: the entry form's note
 * says "done", so a press there puts the keyboard away rather than diving into
 * the split editor underneath, and the split's own last row does the same
 * rather than wrapping round.
 *
 * **A field inside a `<form>` is left alone.** Its Enter is already spoken
 * for — the add row files the name and hands the caret straight back, a dialog
 * submits its card — and those are better answers than either of these.
 *
 * The caret goes to the *end* of what is already in the field it lands in: a
 * field entered at character nought turns a typed "5" into "512.00", and the
 * columns this walks are full of figures somebody is replacing.
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
