"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { note, traceMenu } from "../lib/menu-trace";

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * A handful of actions for the row that was long-pressed or right-clicked — a
 * small card, not a dialog that dims the whole screen behind it (that's for a
 * decision with a sentence to say about it; this is a menu).
 *
 * It hangs off the row's own bottom right corner, and where inside the row the
 * finger landed makes no difference to that: a card that chased the touch
 * appeared somewhere new every time, and a second press had to hunt for the
 * item it had just used. Flipped above the row when there isn't room below it,
 * and kept off the screen edges either way.
 *
 * An invisible veil behind the card catches the outside tap that closes it;
 * Escape and a scroll (captured on `document`, since the scrolling element is
 * `.scroll`, not the window) do the same — so the row's position is read once,
 * when the menu opens, and cannot go stale under it.
 */
export function RowMenu({ anchor, actions, onClose }: {
  /** The pressed row, in viewport coordinates. */
  anchor: DOMRect; actions: SheetAction[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // First, so the recorder is listening before the effects below add the
  // listeners it exists to explain (lib/menu-trace.ts). Every way out notes
  // itself, so a card that went away on its own — a re-render from under it,
  // rather than a press — is the trace with no reason at the end of it.
  useEffect(() => traceMenu(actions.length), []);

  // An action list that grows while the card is open moves every item below
  // the new one, and the card was measured and placed before it did. The one
  // that does this is the groups list, whose invite link resolves late.
  const drew = useRef(actions.length);
  useEffect(() => {
    if (drew.current === actions.length) return;
    note(`items ${drew.current}->${actions.length}`);
    drew.current = actions.length;
  });

  // Positioned after the first paint, once the card's real size is known —
  // a guessed size would either clip at the screen edge or leave a gap.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const below = anchor.bottom + gap;
    setPos({
      // Right edges aligned, so the card sits under the end of the row it
      // belongs to rather than under the finger.
      left: Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)),
      top: below + height + margin <= window.innerHeight
        ? below
        : Math.max(margin, anchor.top - gap - height),
    });
  }, [anchor]);

  // Nothing focuses this card, so opening it left the caret on the row behind
  // the veil: Escape closed a menu the keyboard was never in, and Tab walked
  // the page underneath it. `Dialog` gets all of that from `showModal()`; a
  // card anchored to a row cannot be a modal dialog, so it moves focus itself
  // and hands it back on the way out.
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const back = opener.current;
      // A menu action can unmount the row it was opened from — forgetting the
      // group is one — and can open a dialog of its own, which takes focus
      // after this runs.
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    // Held hidden until it has been measured and placed, and a hidden element
    // cannot take focus — so wait for the position rather than race it.
    // `preventScroll` because the card is already inside the viewport by then,
    // and a scroll is what closes this menu.
    if (!pos) return;
    ref.current?.querySelector<HTMLButtonElement>(".rowmenu-item")
      ?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { note("esc"); onClose(); } }
    const onScroll = () => { note("scroll"); onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="rowmenu-veil" onClick={() => { note("veil"); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); note("veil-menu"); onClose(); }} />
      <div className="rowmenu" ref={ref} role="menu"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
        {actions.map((a) => (
          <button key={a.label} type="button" className="rowmenu-item" role="menuitem"
            onClick={() => { note("chose"); onClose(); a.onSelect(); }}>
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

/**
 * The same card, opened by a tap on an icon button instead of by a long press
 * on a row — what a top bar uses when its actions outgrow the space for them.
 * `RowMenu` hangs off the button's own rectangle, so the card lands under the
 * control that opened it and its right edge lines up with the screen's.
 */
export function MenuButton({ icon, label, actions, confirmed = false }: {
  icon: IconName; label: string; actions: SheetAction[];
  /**
   * An action inside the menu has just done something, and there is nothing
   * left on screen to say so: the card closed on the tap. The button wears the
   * check the same action's own button wears elsewhere (`InviteButton`), so
   * copying the link from the menu and copying it from People's top bar
   * confirm themselves the same way.
   */
  confirmed?: boolean;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button type="button" className="iconbtn" aria-label={label} aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        <Icon name={confirmed ? "check" : icon} size={18}
          style={confirmed ? { color: "var(--brand)" } : undefined} />
      </button>
      {anchor ? <RowMenu anchor={anchor} actions={actions} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
