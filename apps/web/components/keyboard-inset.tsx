"use client";

import { useEffect } from "react";

/**
 * How much of the app the on-screen keyboard is sitting on top of, as `--kb`.
 *
 * The shell is `100dvh` and never scrolls (globals.css), which is right until
 * a keyboard opens: on iOS it and its accessory bar — the suggestion strip,
 * the "Done" and arrow buttons — are drawn *over* the layout viewport rather
 * than shortening it, so `dvh` doesn't move, `.scroll`'s bottom edge is now
 * behind the keyboard, and anything scrolled to that edge is under the
 * accessory bar. Scrolling a field into view lands it exactly there, which is
 * the one place it must not be.
 *
 * The visual viewport is what is actually left, so the difference is the
 * covered strip. `.scroll` spends it as real space at the end of the list and
 * as `scroll-padding-bottom`, so every scroll — ours and the browser's own on
 * focus — stops short of the keyboard instead of under it.
 *
 * Set on `<html>` rather than the shell because dialogs and the FAB live
 * outside it, and a value on the root is reachable from all of them — the
 * dialog scrim spends it the same way, so a card asking for a number is
 * centred above the keyboard rather than behind it.
 */
export function KeyboardInset() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const root = document.documentElement;
    let frame = 0;

    function measure() {
      if (!view) return;
      const covered = window.innerHeight - view.height - view.offsetTop;
      // A pixel or two is the mobile toolbar settling, not a keyboard, and
      // paying it as padding would twitch the end of every list.
      const kb = covered > 4 ? Math.round(covered) : 0;
      root.style.setProperty("--kb", `${kb}px`);
      // Whether there is a keyboard at all is this component's to know; how
      // much air to leave above one is the stylesheet's (`--kb-gap`).
      root.toggleAttribute("data-kb", kb > 0);
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
    return () => {
      cancelAnimationFrame(frame);
      view.removeEventListener("resize", onResize);
      view.removeEventListener("scroll", measure);
      root.style.removeProperty("--kb");
      root.removeAttribute("data-kb");
    };
  }, []);
  return null;
}
