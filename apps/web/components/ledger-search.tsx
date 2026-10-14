"use client";
// Doc: docs/frontend.md#the-ledgers-search

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { copy } from "@/lib/copy";
import { yieldPosition } from "@/lib/ledger-position";
import { keepQuery, openingQuery, shownAt } from "@/lib/ledger-search";
import { route } from "@/lib/group-link";
import { returnTo } from "@/lib/nav";
import { useHoldsWork } from "@/lib/update";
import { calmly, glide } from "@/lib/seek";
import { Icon } from "./icons";

/**
 * The ledger's own address, not `location.href`: a screen mounted in its first
 * frame renders before the router moves the URL, and would read the screen it
 * is leaving — the list, freshly gone back to, as a way back here.
 */
function returning(groupId: string): boolean {
  return returnTo(route.group(groupId)) !== null;
}

export function useLedgerQuery(groupId: string): [string, (query: string) => void] {
  const [query, setQuery] = useState(() => openingQuery(groupId, returning(groupId)));
  useHoldsWork(query !== "");
  return [query, (next) => {
    keepQuery(groupId, next);
    setQuery(next);
  }];
}

function searchBase(box: HTMLElement, bar: number): number {
  return Math.max(0, (box.querySelector<HTMLElement>(".lrows")?.offsetTop ?? 0) - bar);
}

const REVEAL_MS = 180;

const PRESS_MS = 700;

/** The mounted bar's way in from the group menu. */
let summon: (() => void) | null = null;

/** The group menu's **Search**: the caret in the bar, and the list glided to the base state. */
export function summonLedgerSearch(): void {
  summon?.();
}

export function LedgerSearch({ groupId, query, onQuery, listed = query }: {
  groupId: string;
  query: string;
  onQuery: (query: string) => void;
  /** The search the list below shows, which trails `query` while it searches. */
  listed?: string;
}) {
  const dock = useRef<HTMLDivElement>(null);
  // Found by position, not a ref: a later sibling's ref isn't attached when this
  // layout effect runs.
  const scroller = () => {
    const next = dock.current?.nextElementSibling;
    return next instanceof HTMLElement ? next : null;
  };
  const bar = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const held = focused || query !== "";
  // Not state: a render is a frame late, and a frame without the bar flickers.
  const shown = useRef<number | null>(null);
  const lent = useRef(returning(groupId));
  const base = (box: HTMLElement) => searchBase(box, bar.current?.offsetHeight ?? 0);

  // A layout effect, so the room is there before the ledger restores its position
  // (lib/ledger-position.ts).
  useLayoutEffect(() => {
    const box = scroller();
    const el = dock.current;
    if (!box || !el) return;
    el.toggleAttribute("data-room", lent.current);
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      frame = 0;
      const want = held ? 1 : shownAt(box.scrollTop, base(box), bar.current?.offsetHeight ?? 0);
      const from = shown.current ?? want;
      const reach = held || calmly() ? 1 : (now - last) / REVEAL_MS;
      last = now;
      const to = Math.abs(want - from) <= reach ? want : from + Math.sign(want - from) * reach;
      shown.current = to;
      el.style.setProperty("--shown", String(to));
      el.toggleAttribute("data-on", to > 0);
      lent.current = held || to > 0 || (lent.current && box.scrollTop > 0);
      el.toggleAttribute("data-room", lent.current);
      if (to !== want) frame = requestAnimationFrame(step);
    };
    const ask = () => {
      if (frame) return;
      last = performance.now() - 16;
      frame = requestAnimationFrame(step);
    };
    ask();
    box.addEventListener("scroll", ask, { passive: true });
    const sizes = new ResizeObserver(ask);
    const head = box.querySelector(".lhead");
    if (head) sizes.observe(head);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      box.removeEventListener("scroll", ask);
      sizes.disconnect();
    };
  }, [held]);

  // With the list it moves, not the field.
  const placed = useRef(listed);
  useLayoutEffect(() => {
    const box = scroller();
    if (!box || placed.current === listed) return;
    placed.current = listed;
    box.scrollTop = listed === "" ? base(box) : 0;
  }, [listed]);

  const gliding = useRef<(() => void) | null>(null);
  const stopGlide = () => { gliding.current?.(); gliding.current = null; };
  const glideTo = (box: HTMLElement, top: number) => {
    stopGlide();
    yieldPosition();
    gliding.current = glide(box, top, () => { gliding.current = null; });
  };
  useEffect(() => stopGlide, []);

  const driving = useRef(false);
  const pressed = useRef(0);
  const holding = useRef(false);
  useEffect(() => {
    const box = scroller();
    if (!box) return;
    const drive = () => {
      if (document.activeElement !== field.current) return;
      driving.current = true;
      field.current?.blur();
      driving.current = false;
    };
    const press = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("a, button")) pressed.current = Date.now();
    };
    // A press anywhere still down: the menu it opens would be closed by the glide.
    const hold = (e: PointerEvent) => {
      holding.current = e.type === "pointerdown" && e.target instanceof Element && e.target.closest("a, button") !== null;
    };
    box.addEventListener("touchmove", drive, { passive: true });
    box.addEventListener("wheel", drive, { passive: true });
    box.addEventListener("pointerdown", press, { passive: true });
    const edges = ["pointerdown", "pointerup", "pointercancel"] as const;
    for (const type of edges) document.addEventListener(type, hold, { capture: true, passive: true });
    return () => {
      box.removeEventListener("touchmove", drive);
      box.removeEventListener("wheel", drive);
      box.removeEventListener("pointerdown", press);
      for (const type of edges) document.removeEventListener(type, hold, { capture: true });
    };
  }, []);

  const letGo = (e: React.FocusEvent) => {
    setFocused(false);
    const box = scroller();
    // The caret taken by something else — a menu's first item — was taken, not let go of.
    if (!box || query !== "" || driving.current || holding.current || e.relatedTarget || Date.now() - pressed.current < PRESS_MS) return;
    if (box.scrollTop === 0 || box.scrollTop > base(box) + 1) return;
    glideTo(box, 0);
  };

  useEffect(() => {
    summon = () => {
      const box = scroller();
      const input = field.current;
      if (!box || !input) return;
      // Out before the caret: away, the bar is not drawn and can't hold one.
      // And all of it in the tap's own turn, or iOS keeps its keyboard down.
      flushSync(() => setFocused(true));
      input.focus({ preventScroll: true });
      if (document.activeElement !== input) { setFocused(false); return; }
      // Over a search already up, its results are where they should be.
      if (input.value === "") glideTo(box, base(box));
    };
    return () => { summon = null; };
  });

  return (
    // Standing in the column follows the list, not the field: a frame ahead,
    // the bar pushed the list down onto the foot of the head it was covering.
    <div className="searchdock" ref={dock} role="search"
      data-held={held ? "" : undefined} data-searching={listed ? "" : undefined}>
      <div className="searchclip">
        <div className="searchbar" ref={bar}>
          <label className="field">
            <Icon name="search" size={15} className="muted" style={{ flex: "none" }} />
            <input ref={field} value={query} onChange={(e) => onQuery(e.target.value)}
              placeholder={copy.group.search.field} aria-label={copy.group.search.field}
              inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
              autoComplete="off" spellCheck={false}
              onFocus={(e) => {
                stopGlide();
                setFocused(true);
                // Taken from a bar the scroll has only part out: the rest of the way, as the menu's.
                const box = scroller();
                if (box && e.currentTarget.value === "" && box.scrollTop < base(box) - 1) glideTo(box, base(box));
              }} onBlur={letGo}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
            {query ? (
              <button type="button" className="searchclear" aria-label={copy.group.search.clear}
                // Android keeps the caret in a field whose keyboard was
                // dismissed; focusing it again would raise the keyboard.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onQuery("")}>
                <Icon name="cross" size={14} />
              </button>
            ) : null}
          </label>
        </div>
      </div>
    </div>
  );
}
