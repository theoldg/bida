"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { returnTo } from "@/lib/nav";
import { glide } from "@/lib/seek";
import { Icon } from "./icons";

/**
 * What each group's ledger was last searched for, kept for the way back to it
 * like its position (lib/ledger-position.ts): a result opened and backed out
 * of returns to the results. A tap into the group starts blank.
 */
const kept = new Map<string, string>();

export function useLedgerQuery(groupId: string): [string, (query: string) => void] {
  const [query, setQuery] = useState(() => (returnTo(location.href) === null ? "" : kept.get(groupId) ?? ""));
  return [query, (next) => {
    if (next) kept.set(groupId, next);
    else kept.delete(groupId);
    setQuery(next);
  }];
}

/**
 * The search's base state: the bar out, empty, and the whole ledger under it
 * with its first row where the first result would be — where a search starts
 * from and where clearing one returns to. This is the `scrollTop` that puts
 * the list there, given the ledger's scroller.
 */
export function searchBase(box: HTMLElement): number {
  const rows = box.querySelector<HTMLElement>(".lrows");
  const bar = box.parentElement?.querySelector<HTMLElement>(".searchbar");
  return Math.max(0, (rows?.offsetTop ?? 0) - (bar?.offsetHeight ?? 0));
}

/**
 * The group menu's way in: the caret in the bar, which brings it out, and the
 * list gliding to the base state under it. The focus is in the tap's own turn,
 * or iOS keeps its keyboard down; the bar is taken out of `inert` by hand for
 * that, since hidden it can't hold a caret.
 */
export function summonLedgerSearch(): void {
  const bar = document.querySelector<HTMLElement>(".searchbar");
  const field = bar?.querySelector("input");
  const box = bar?.closest(".appbody")?.querySelector<HTMLElement>(".scroll");
  if (!bar || !field) return;
  const was = bar.inert;
  bar.inert = false;
  // The glide is the only thing that may move the list here.
  field.focus({ preventScroll: true });
  if (document.activeElement !== field) { bar.inert = was; return; }
  // Not over a search already up: its results are where they should be.
  if (box && field.value === "") glide(box, searchBase(box), () => {});
}

/** How long the bar eases for when it is taken from the scroll or handed back (ms); `.searchdock[data-ease]`'s. */
const EASE_MS = 260;

/**
 * The ledger's search: a bar that comes out from under the top bar as the
 * you-owe card (`banner`) leaves the list's view. **Tied to the scroll, not
 * set off by it**: each pixel the card's foot travels past the top edge brings
 * a pixel of the bar, so a slow scroll unfolds it slowly and stopping halfway
 * leaves it halfway. Typed in or holding a query it is out whole, wherever the
 * list is.
 *
 * Idle it lies over the head of the list, so showing it moves nothing; holding
 * a query it takes its own room (`.searchdock[data-searching]`), since the
 * results start under it.
 */
export function LedgerSearch({ banner, query, onQuery }: {
  banner: HTMLElement | null; query: string; onQuery: (query: string) => void;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const held = focused || query !== "";
  // Whether any of it shows: all a render needs to know. How much is written
  // straight onto the dock as `--shown`, a frame at a time.
  const [out, setOut] = useState(false);
  useEffect(() => {
    const box = banner?.closest<HTMLElement>(".scroll");
    const bar = dock.current?.querySelector<HTMLElement>(".searchbar");
    if (!banner || !box || !bar) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Not drawn (a search hides the head) is as gone as scrolled away.
      const past = banner.offsetParent === null ? Infinity
        : box.getBoundingClientRect().top - banner.getBoundingClientRect().bottom;
      const shown = Math.min(1, Math.max(0, past / bar.offsetHeight));
      dock.current?.style.setProperty("--shown", String(shown));
      setOut(shown > 0);
    };
    const ask = () => { frame ||= requestAnimationFrame(measure); };
    measure();
    box.addEventListener("scroll", ask, { passive: true });
    // What sits above the card comes and goes without a scroll.
    const sizes = new ResizeObserver(ask);
    sizes.observe(banner);
    if (banner.parentElement) sizes.observe(banner.parentElement);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      box.removeEventListener("scroll", ask);
      sizes.disconnect();
    };
  }, [banner]);

  // Taken from the scroll or handed back, the bar has a distance to cover that
  // no finger is moving it through, so that one move is eased.
  const [ease, setEase] = useState(false);
  const was = useRef(held);
  useEffect(() => {
    if (was.current === held) return;
    was.current = held;
    setEase(true);
    const timer = setTimeout(() => setEase(false), EASE_MS);
    return () => clearTimeout(timer);
  }, [held]);

  const on = out || held;
  return (
    <div className="searchdock" ref={dock} data-on={on ? "" : undefined} data-held={held ? "" : undefined}
      data-ease={ease ? "" : undefined} data-searching={query ? "" : undefined}>
      <div className="searchclip">
        <div className="searchbar" inert={!on}>
          <label className="field">
            <Icon name="search" size={15} className="muted" style={{ flex: "none" }} />
            <input value={query} onChange={(e) => onQuery(e.target.value)}
              placeholder={copy.group.search.field} aria-label={copy.group.search.field}
              inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
              autoComplete="off" spellCheck={false}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              // The confirm key has nothing to submit: the list is already the answer.
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
            {query ? (
              <button type="button" className="searchclear" aria-label={copy.group.search.clear}
                // The caret stays: clearing is the start of the next search as often as the end of this one.
                onClick={(e) => { onQuery(""); e.currentTarget.parentElement?.querySelector("input")?.focus(); }}>
                <Icon name="cross" size={14} />
              </button>
            ) : null}
          </label>
        </div>
      </div>
    </div>
  );
}
