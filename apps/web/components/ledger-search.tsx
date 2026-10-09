"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { copy } from "@/lib/copy";
import { shownAt } from "@/lib/ledger-search";
import { returnTo } from "@/lib/nav";
import { calmly, glide } from "@/lib/seek";
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
 * the list there, under a bar `bar` pixels tall.
 */
function searchBase(box: HTMLElement, bar: number): number {
  return Math.max(0, (box.querySelector<HTMLElement>(".lrows")?.offsetTop ?? 0) - bar);
}

/** The least time the scroll may take to bring the whole bar out or put it away (ms). */
const REVEAL_MS = 180;

/** How long after a press on a row a field let go of is taken to be that press's doing (ms). */
const PRESS_MS = 700;

/** The mounted bar's way in from the group menu. */
let summon: (() => void) | null = null;

/** The group menu's **Search**: the caret in the bar, wherever the list is. */
export function summonLedgerSearch(): void {
  summon?.();
}

/**
 * The ledger's search: a bar that comes out from under the top bar. One rule
 * places it — **held, it is out whole; otherwise it is where the scroll puts
 * it** (`shownAt`) — and held is the caret in it or a query typed.
 *
 * - **The scroll** unfolds it as slowly as it is scrolled, and stopping
 *   halfway leaves it halfway — up to a speed (`REVEAL_MS`), past which it
 *   slides out behind a fling rather than appearing whole.
 * - **The group menu** puts the caret in it, and glides the list to the base
 *   state (`searchBase`) under it.
 * - **A query** stands it in the column (`.searchdock[data-searching]`) with
 *   the results from its foot; emptied, the list is back at the base state.
 * - **Let go of empty** at the base state or short of it, the list glides
 *   back to its head, and the bar goes with it as the scroll's. Not when a
 *   finger on the list is what let go — a drag does, and it is driving — nor
 *   on the way into a row.
 *
 * Idle it lies over the head of the list, so showing it moves nothing.
 */
export function LedgerSearch({ scroll, query, onQuery }: {
  /** The ledger's scroller: its head in `.lhead`, its rows in `.lrows`. */
  scroll: RefObject<HTMLElement | null>;
  query: string;
  onQuery: (query: string) => void;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const held = focused || query !== "";
  // Whether any of it is drawn: all a render needs to know. How much is
  // `shown`, written straight onto the dock as `--shown` a frame at a time.
  const [out, setOut] = useState(false);
  const on = out || held;
  const shown = useRef<number | null>(null);
  // A list too short to scroll to the base state is lent the room to
  // (`.searchroom`) while the bar is out, and keeps it until it is back at
  // its head: taken any sooner, the list would drop there.
  const [room, setRoom] = useState(false);
  const base = (box: HTMLElement) => searchBase(box, bar.current?.offsetHeight ?? 0);

  // The bar follows the scroll, or stands whole while held. What is drawn
  // chases what is wanted by no more than the whole bar per `REVEAL_MS`: a
  // slow scroll never asks for more, so the bar stays under the finger, and a
  // fling gets a slide instead of a cut.
  useEffect(() => {
    const box = scroll.current;
    const el = dock.current;
    if (!box || !el) return;
    let frame = 0;
    let last = performance.now() - 16;
    const step = (now: number) => {
      frame = 0;
      const want = held ? 1 : shownAt(box.scrollTop, base(box), bar.current?.offsetHeight ?? 0);
      // Arriving, it is where it should be; held, CSS has it whole already.
      const from = shown.current ?? want;
      const reach = held || calmly() ? 1 : (now - last) / REVEAL_MS;
      last = now;
      const to = Math.abs(want - from) <= reach ? want : from + Math.sign(want - from) * reach;
      shown.current = to;
      el.style.setProperty("--shown", String(to));
      setOut(to > 0);
      const atHead = box.scrollTop <= 0;
      setRoom((lent) => held || to > 0 || (lent && !atHead));
      if (to !== want) frame = requestAnimationFrame(step);
    };
    const ask = () => {
      if (frame) return;
      // A frame's worth to start with, as if the last one had just been drawn.
      last = performance.now() - 16;
      frame = requestAnimationFrame(step);
    };
    step(performance.now());
    box.addEventListener("scroll", ask, { passive: true });
    // The head comes and goes without a scroll: a card folded, a search begun.
    const sizes = new ResizeObserver(ask);
    const head = box.querySelector(".lhead");
    if (head) sizes.observe(head);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      box.removeEventListener("scroll", ask);
      sizes.disconnect();
    };
  }, [held, scroll]);

  // A query begun or changed reads from its first result; emptied, the list
  // is at the base state. After the commit: the head is back in the column.
  const placed = useRef(query);
  useLayoutEffect(() => {
    const box = scroll.current;
    if (!box || placed.current === query) return;
    placed.current = query;
    box.scrollTop = query === "" ? base(box) : 0;
  }, [query, scroll]);

  // The one glide this owns at a time: to the base state, or back to the head.
  const gliding = useRef<(() => void) | null>(null);
  const stopGlide = () => { gliding.current?.(); gliding.current = null; };
  const glideTo = (box: HTMLElement, top: number) => {
    stopGlide();
    gliding.current = glide(box, top, () => { gliding.current = null; });
  };
  useEffect(() => stopGlide, []);

  // **The caret pins nothing a finger wants moved**: a drag on the list, or a
  // wheel, lets go of the field. And a press on a row is noted, for `letGo`.
  const driving = useRef(false);
  const pressed = useRef(0);
  useEffect(() => {
    const box = scroll.current;
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
  }, [scroll]);

  const letGo = () => {
    setFocused(false);
    const box = scroll.current;
    if (!box || query !== "" || driving.current || Date.now() - pressed.current < PRESS_MS) return;
    // Already at its head, or further down than the base state: nothing to undo.
    if (box.scrollTop === 0 || box.scrollTop > base(box) + 1) return;
    glideTo(box, 0);
  };

  useEffect(() => {
    summon = () => {
      const box = scroll.current;
      const input = field.current;
      if (!box || !input) return;
      // Out before the caret: away, the bar is not drawn and can't hold one.
      // And all of it in the tap's own turn, or iOS keeps its keyboard down.
      flushSync(() => setFocused(true));
      // The glide is the only thing that may move the list here.
      input.focus({ preventScroll: true });
      if (document.activeElement !== input) { setFocused(false); return; }
      // Not over a search already up: its results are where they should be.
      if (input.value === "") glideTo(box, base(box));
    };
    return () => { summon = null; };
  });

  return (
    <div className="searchdock" ref={dock} role="search" data-on={on ? "" : undefined} data-room={room || on ? "" : undefined}
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
              // The confirm key has nothing to submit: the list is already the answer.
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
            {query ? (
              <button type="button" className="searchclear" aria-label={copy.group.search.clear}
                // The press never takes the focus, so the field is left as it was: the caret
                // stays if it was there, and a keyboard that was down stays down — Android
                // keeps the caret in a field whose keyboard was dismissed, and focusing it
                // again would raise it.
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
