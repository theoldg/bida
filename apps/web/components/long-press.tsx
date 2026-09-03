"use client";

import { useState, type MouseEvent } from "react";
import { RowMenu, type SheetAction } from "./row-menu";

/**
 * Opens a small menu of actions on a long press — or a right click, which
 * arrives as the same `contextmenu` event a touch hold does. `NoLongPress`
 * (components/no-long-press.tsx) already listens for that event globally and
 * swallows it everywhere; `stopPropagation` here keeps this row from also
 * running that handler once it's opened its own menu instead.
 */
export function useLongPressMenu(actions: SheetAction[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return {
    onContextMenu: (e: MouseEvent) => {
      if (actions.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY });
    },
    menu: at
      ? <RowMenu x={at.x} y={at.y} actions={actions} onClose={() => setAt(null)} />
      : null,
  };
}
