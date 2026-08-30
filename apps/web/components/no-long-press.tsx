"use client";

import { useEffect } from "react";

/**
 * A long press on a ledger row is a mis-tap, not a request for the browser's
 * link menu. CSS already suppresses iOS's callout (`-webkit-touch-callout`),
 * but Chrome on Android raises "Open in new tab / Copy link address / Share"
 * for any `<a href>` — every row in this app — and that is only reachable from
 * the event. Suppressed here rather than per screen, since it is wrong on all
 * of them.
 *
 * Only touch-driven menus go: a real right-click still works, so the desktop
 * browser stays a normal browser. Fields you can type in keep theirs, or
 * long-pressing to paste would break.
 */
export function NoLongPress() {
  useEffect(() => {
    let touched = false;

    const onPointerDown = (e: PointerEvent) => {
      touched = e.pointerType === "touch" || e.pointerType === "pen";
    };

    const onContextMenu = (e: Event) => {
      if (!touched) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable='true'], .selectable")
      ) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);
  return null;
}
