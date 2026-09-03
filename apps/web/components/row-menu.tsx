"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * A handful of actions anchored to where a long press or a right click
 * happened — a small card near the finger, not a dialog that dims the
 * whole screen behind it (that's for a decision with a sentence to say
 * about it; this is a menu). An invisible veil behind the card catches the
 * outside tap that closes it; Escape and a scroll (captured on `document`,
 * since the scrolling element is `.scroll`, not the window) do the same.
 */
export function RowMenu({ x, y, actions, onClose }: {
  x: number; y: number; actions: SheetAction[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Positioned after the first paint, once the card's real size is known —
  // a guessed size would either clip at the screen edge or leave a gap.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.min(x, window.innerWidth - width - margin),
      top: Math.min(y, window.innerHeight - height - margin),
    });
  }, [x, y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="rowmenu-veil" onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="rowmenu" ref={ref} role="menu"
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}>
        {actions.map((a) => (
          <button key={a.label} type="button" className="rowmenu-item" role="menuitem"
            onClick={() => { onClose(); a.onSelect(); }}>
            {a.icon
              ? <Icon name={a.icon} size={15} style={a.danger ? { color: "var(--debit)" } : undefined} />
              : null}
            <span style={a.danger ? { color: "var(--debit)" } : undefined}>{a.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
