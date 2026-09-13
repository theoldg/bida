"use client";

import { useState, type MouseEvent } from "react";
import { tick } from "../lib/haptics";
import { RowMenu, type SheetAction } from "./row-menu";

/**
 * Opens a small menu of actions on a long press — or a right click, which
 * arrives as the same `contextmenu` event a touch hold does. `NoLongPress`
 * (components/no-long-press.tsx) already listens for that event globally and
 * swallows it everywhere; `stopPropagation` here keeps this row from also
 * running that handler once it's opened its own menu instead.
 *
 * What is remembered is the row, not the point pressed: `RowMenu` opens in the
 * same place for a given row however it was reached.
 */
export function useLongPressMenu(actions: SheetAction[]) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return {
    onContextMenu: (e: MouseEvent) => {
      if (actions.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      // The one press in the app with no wash under it — the finger is still
      // down and the menu opens above it, so the tick is what says the hold
      // landed (lib/haptics.ts).
      tick();
      setAnchor(e.currentTarget.getBoundingClientRect());
    },
    menu: anchor
      ? <RowMenu anchor={anchor} actions={actions} onClose={() => setAnchor(null)} />
      : null,
  };
}
