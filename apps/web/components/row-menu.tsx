"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { clickGuard } from "../lib/click-guard";
import { note, tracePress } from "../lib/press-trace";

/**
 * How long a lift waits for the click that should follow it.
 *
 * A tap's events arrive in one burst — the click that works comes ~5ms after
 * the lift — so this is many times over what it is waiting for, and is spent
 * only on a press that was never going to bring one.
 */
const CLICK_GRACE_MS = 150;

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * A handful of actions for the row that was long-pressed or right-clicked — a
 * small card, not a dialog that dims the whole screen (that's for a decision
 * with a sentence to say about it; this is a menu).
 *
 * **It hangs off the row's bottom right corner, never off the finger** — a card
 * that chases the touch appears somewhere new every time, and a second press
 * has to hunt for the item it just used. Flipped above the row when there isn't
 * room below, and kept off the screen edges either way.
 *
 * **An item's click may never come.** On iOS a tap can land whole on one —
 * `pointerdown`, `pointerup`, `touchstart`, `touchend`, no `pointercancel` —
 * and bring no `click` at all, so the card sat there and the press had to be
 * made twice. **So the lift answers for it — but only after waiting to see.**
 * Taking the lift outright instead was worse than what it fixed: `click` is
 * the *last* event of a touch, and acting on `pointerup` left `touchend`,
 * `mousedown` and `mouseup` still to be delivered, onto whatever the action
 * had by then drawn. On Android that `mousedown` landed on the confirm
 * dialog the item had just opened and dismissed it 6ms later, so Delete and
 * Forget did nothing at all — on the rows whose menu sat clear of the
 * dialog's card, which is most of them. frontend.md's Gotchas has the whole
 * of it; a `/diag` trace is what caught the first half (`lib/press-trace.ts`).
 *
 * An invisible veil catches the outside tap that closes it; Escape and a scroll
 * (captured on `document` — the scrolling element is `.scroll`, not the window)
 * do the same, so the row's position is read once and cannot go stale under it.
 */
export function RowMenu({ anchor, actions, onClose }: {
  /** The pressed row, in viewport coordinates. */
  anchor: DOMRect; actions: SheetAction[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // First, so the recorder is listening before the effects below add the
  // listeners it exists to explain (lib/press-trace.ts). Every way out notes
  // itself, so a card that went away on its own — a re-render from under it,
  // rather than a press — is the trace with no reason at the end of it.
  useEffect(() => tracePress("menu.trace", `items=${actions.length}`), []);

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

  // `Dialog` gets focus handling from `showModal()`; a card anchored to a row
  // cannot be a modal dialog, so **it moves focus in itself and hands it back on
  // the way out** — otherwise the caret stays on the row behind the veil, Escape
  // closes a menu the keyboard was never in, and Tab walks the page underneath.
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

  /** The pointer whose press started on an item, so its lift can finish there. */
  const finger = useRef(-1);
  /** A lift still waiting to see whether its click is coming. */
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
              // A touch's `pointerup` goes to its `pointerdown`'s element
              // however far the finger has moved, so where it landed is asked
              // rather than assumed: sliding off "Delete" calls that press off.
              const under = document.elementFromPoint(e.clientX, e.clientY);
              if (!e.currentTarget.contains(under)) return;
              // The click, when there is one, is a few ms behind this — so wait
              // for it rather than take the lift outright, and act only if none
              // comes. See CLICK_GRACE_MS.
              waiting.current = setTimeout(() => {
                note("no click");
                // It can still turn up late, and the card has gone with the
                // press: it would land on the row underneath, or on the screen
                // the action just opened.
                clickGuard().expire();
                choose(a);
              }, CLICK_GRACE_MS);
            }}
            onPointerCancel={() => { finger.current = -1; }}
            onClick={() => choose(a)}>
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
