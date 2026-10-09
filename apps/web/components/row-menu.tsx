"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlipCheck, Icon, type IconName } from "./icons";
import { clickGuard } from "../lib/click-guard";
import { note, tracePress } from "../lib/press-trace";

/** A working click comes ~5ms after the lift, so this is only spent on a press that brings none. */
const CLICK_GRACE_MS = 150;

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Hangs off the row's corner, never off the finger, so a second press finds
 * the item where it was.
 *
 * **An item's click may never come** on iOS, so the lift answers, but only
 * after waiting to see: acting on `pointerup` outright lets the `mousedown`
 * that follows land on whatever the action drew. On Android it dismissed the
 * confirm dialog the item had just opened (docs/touch-and-viewport.md).
 *
 * A scroll closes it, so the row's position can't go stale under it.
 */
export function RowMenu({ anchor, actions, onClose }: {
  /** The pressed row, in viewport coordinates. */
  anchor: DOMRect; actions: SheetAction[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // First, so the recorder hears the effects below. Every way out notes itself.
  useEffect(() => tracePress("menu.trace", `items=${actions.length}`), []);

  // An action list that grows while open (the groups list's invite link
  // resolves late) moves items the card was placed around.
  const drew = useRef(actions.length);
  useEffect(() => {
    if (drew.current === actions.length) return;
    note(`items ${drew.current}->${actions.length}`);
    drew.current = actions.length;
  });

  // Once the card's real size is known; a guess would clip or leave a gap.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const below = anchor.bottom + gap;
    setPos({
      left: Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)),
      top: below + height + margin <= window.innerHeight
        ? below
        : Math.max(margin, anchor.top - gap - height),
    });
  }, [anchor]);

  // Not a modal dialog, so it moves focus in and back itself, or Escape and
  // Tab act on the page behind.
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const back = opener.current;
      // The action may have unmounted the row, or opened a dialog that takes focus after this —
      // or put the caret somewhere itself (the ledger's search), which is not to be taken back.
      const taken = document.activeElement !== null && document.activeElement !== document.body;
      if (back instanceof HTMLElement && back.isConnected && !taken) back.focus();
    };
  }, []);

  useEffect(() => {
    // Hidden can't take focus. `preventScroll`, because a scroll closes this menu.
    if (!pos) return;
    ref.current?.querySelector<HTMLButtonElement>(".rowmenu-item")
      ?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    // Spent here, or it also climbs out of the screen (lib/back-button.ts).
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); note("esc"); onClose(); }
    }
    const onScroll = () => { note("scroll"); onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const finger = useRef(-1);
  const waiting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(waiting.current), []);
  const choose = (a: SheetAction) => {
    clearTimeout(waiting.current);
    note("chose");
    onClose();
    a.onSelect();
  };

  return (
    <>
      <div className="rowmenu-veil" onClick={() => { note("veil"); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); note("veil-menu"); onClose(); }} />
      <div className="rowmenu" ref={ref} role="menu"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
        {actions.map((a) => (
          <button key={a.label} type="button" className="rowmenu-item" role="menuitem"
            onPointerDown={(e) => { finger.current = e.pointerType === "mouse" ? -1 : e.pointerId; }}
            onPointerUp={(e) => {
              if (e.pointerId !== finger.current) return;
              finger.current = -1;
              // `pointerup` goes to the pressed element however far the finger
              // moved; sliding off "Delete" calls that press off.
              const under = document.elementFromPoint(e.clientX, e.clientY);
              if (!e.currentTarget.contains(under)) return;
              waiting.current = setTimeout(() => {
                note("no click");
                // A late click would land on whatever is now underneath.
                clickGuard().expire();
                choose(a);
              }, CLICK_GRACE_MS);
            }}
            onPointerCancel={() => { finger.current = -1; }}
            onClick={() => choose(a)}>
            {a.icon
              ? <Icon name={a.icon} size={17} style={a.danger ? { color: "var(--debit)" } : undefined} />
              : null}
            <span style={a.danger ? { color: "var(--debit)" } : undefined}>{a.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** The same card off an icon button, for a top bar whose actions outgrow it. */
export function MenuButton({ icon, label, actions, confirmed = false }: {
  icon: IconName; label: string; actions: SheetAction[];
  /** An action just did something: the icon flips to a check, as copying the link does elsewhere. */
  confirmed?: boolean;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button type="button" className="iconbtn" aria-label={label} aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        <FlipCheck name={icon} size={18} on={confirmed} />
      </button>
      {anchor ? <RowMenu anchor={anchor} actions={actions} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
