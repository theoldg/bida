"use client";
// Doc: docs/frontend.md#the-ledgers-search

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { yieldPosition } from "@/lib/ledger-position";
import { keepQuery, openingQuery, shownAt } from "@/lib/ledger-search";
import { returnTo } from "@/lib/nav";
import { useHoldsWork } from "@/lib/update";
import { calmly, glide } from "@/lib/seek";
import { Icon } from "./icons";

export function useLedgerQuery(groupId: string): [string, (query: string) => void] {
  const [query, setQuery] = useState(() => openingQuery(groupId, returnTo(location.href) !== null));
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

export function LedgerSearch({ query, onQuery }: {
  query: string;
  onQuery: (query: string) => void;
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
  const lent = useRef(returnTo(location.href) !== null);
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

  const placed = useRef(query);
  useLayoutEffect(() => {
    const box = scroller();
    if (!box || placed.current === query) return;
    placed.current = query;
    box.scrollTop = query === "" ? base(box) : 0;
  }, [query]);

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
    box.addEventListener("touchmove", drive, { passive: true });
    box.addEventListener("wheel", drive, { passive: true });
    box.addEventListener("pointerdown", press, { passive: true });
    return () => {
      box.removeEventListener("touchmove", drive);
      box.removeEventListener("wheel", drive);
      box.removeEventListener("pointerdown", press);
    };
  }, []);

  const letGo = () => {
    setFocused(false);
    const box = scroller();
    if (!box || query !== "" || driving.current || Date.now() - pressed.current < PRESS_MS) return;
    if (box.scrollTop === 0 || box.scrollTop > base(box) + 1) return;
    glideTo(box, 0);
  };

  return (
    <div className="searchdock" ref={dock} role="search"
      data-held={held ? "" : undefined} data-searching={query ? "" : undefined}>
      <div className="searchclip">
        <div className="searchbar" ref={bar}>
          <label className="field">
            <Icon name="search" size={15} className="muted" style={{ flex: "none" }} />
            <input ref={field} value={query} onChange={(e) => onQuery(e.target.value)}
              placeholder={copy.group.search.field} aria-label={copy.group.search.field}
              inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
              autoComplete="off" spellCheck={false}
              onFocus={() => { stopGlide(); setFocused(true); }} onBlur={letGo}
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
