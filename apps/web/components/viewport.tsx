"use client";

import { useEffect } from "react";
import { mark } from "../lib/diag";
import { gapOf, isTyping } from "../lib/viewport";

/**
 * The one place the visual viewport is measured, and the two things that fall
 * out of it: how much of the app the on-screen keyboard is sitting on top of,
 * as `--kb`, and a layout viewport taller than the screen, which is a bug in
 * the browser and is recorded rather than paid for (lib/viewport.ts).
 *
 * The shell is `100dvh` and never scrolls (globals.css), which is right until a
 * keyboard opens: on iOS it and its accessory bar — the suggestion strip, the
 * "Done" and arrow buttons — are drawn *over* the layout viewport rather than
 * shortening it, so `dvh` doesn't move, `.scroll`'s bottom edge is now behind
 * the keyboard, and anything scrolled to that edge is under the accessory bar.
 * Scrolling a field into view lands it exactly there, which is the one place it
 * must not be.
 *
 * `.scroll` spends the covered strip as real space at the end of the list and
 * as `scroll-padding-bottom`, so every scroll — ours and the browser's own on
 * focus — stops short of the keyboard instead of under it.
 *
 * Set on `<html>` rather than the shell because dialogs and the FAB live
 * outside it, and a value on the root is reachable from all of them — the
 * dialog scrim spends it the same way, so a card asking for a number is centred
 * above the keyboard rather than behind it.
 */
export function MeasureViewport() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let frame = 0;
    let reported = 0;

    function measure() {
      if (!view) return;
      const { kb, unexplained } = gapOf({
        inner: window.innerHeight, visible: view.height, offset: view.offsetTop,
        scale: view.scale, typing: isTyping(document.activeElement),
      });
      root.style.setProperty("--kb", `${kb}px`);
      // Whether there is a keyboard at all is this component's to know; how
      // much air to leave above one is the stylesheet's (`--kb-gap`).
      root.toggleAttribute("data-kb", kb > 0);
      // A gap with nobody typing is the app being painted on a screen shorter
      // than the one it was laid out for: the last strip of every screen — the
      // bottom nav, the about line — is below the fold, in a shell that cannot
      // scroll. Nothing here can give those pixels back, so the recorder takes
      // the measurement instead, and /diag has the number the next time
      // somebody says the tabs went missing.
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
     * The keyboard opening is the one moment worth re-scrolling for: the
     * browser has already put the field flush against the accessory bar by
     * then, and it did that before `--kb` existed. Same call as everywhere
     * else — now with somewhere to stop.
     *
     * A dialog is the other scroller worth following into: its card is centred
     * in what the keyboard leaves (globals.css), and one taller than that
     * scrolls inside itself, so a field below the fold still has to be brought
     * up.
     */
    function follow() {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".scroll, .dialog")) {
        focused.scrollIntoView({ block: "nearest" });
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
