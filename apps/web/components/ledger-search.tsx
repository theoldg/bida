"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
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

/** The least time the scroll may take to bring the whole bar out or put it away (ms). */
const REVEAL_MS = 180;

/** How long the bar eases for when it is taken from the scroll or handed back (ms); `.searchdock[data-ease]`'s. */
const EASE_MS = 260;

/**
 * The ledger's search: a bar that comes out from under the top bar as the
 * you-owe card (`banner`) leaves the list's view. **Tied to the scroll, not
 * set off by it**: over the last bar's height the rows travel towards the base
 * state (`searchBase`), each pixel of theirs brings a pixel of the bar, so it
 * is whole exactly as the first row meets its foot. A slow scroll unfolds it
 * slowly and stopping halfway leaves it halfway — up to a speed
 * (`REVEAL_MS`), past which it slides out behind the scroll rather than
 * appearing whole. Typed in or holding a query it is out whole, wherever the
 * list is.
 *
 * **The caret pins nothing a finger wants moved**: a drag on the list lets go
 * of the field, and with nothing typed the bar is the scroll's again. Let go
 * of any other way at the base state or above it, the list glides back to its
 * head, taking the bar with it.
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
  const [room, setRoom] = useState(false);
  const onNow = useRef(false);
  const handed = useRef(false);
  const pressed = useRef(0);
  useEffect(() => {
    const box = banner?.closest<HTMLElement>(".scroll");
    const bar = dock.current?.querySelector<HTMLElement>(".searchbar");
    if (!banner || !box || !bar) return;
    // What the scroll asks for, and what is drawn. Drawn chases asked at no
    // more than the whole bar per `REVEAL_MS`: a slow scroll never asks for
    // more than that, so the bar stays under the finger, and a fling that
    // would have it there in one frame gets a slide instead of a cut.
    const asked = () => {
      // Asked of the scroller each time: a search redraws the rows' box.
      const rows = box.querySelector<HTMLElement>(".lrows");
      if (!rows) return 0;
      const h = bar.offsetHeight;
      // How far the rows still are from the bar's foot: none at the base state.
      const short = rows.getBoundingClientRect().top - box.getBoundingClientRect().top - h;
      return Math.min(1, Math.max(0, 1 - short / h));
    };
    let shown = asked();
    const draw = () => {
      dock.current?.style.setProperty("--shown", String(shown));
      setOut(shown > 0);
      // The room a short list was lent goes only at its head, where taking it
      // moves nothing (see `room`).
      if (box.scrollTop <= 0 && !onNow.current) setRoom(false);
    };
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      frame = 0;
      const want = asked();
      const reach = calmly() ? 1 : (now - last) / REVEAL_MS;
      last = now;
      shown += Math.min(reach, Math.max(-reach, want - shown));
      draw();
      if (shown !== want) frame = requestAnimationFrame(step);
    };
    const ask = () => {
      if (frame) return;
      // A frame's worth to start with, as if the last one had just been drawn.
      last = performance.now() - 16;
      frame = requestAnimationFrame(step);
    };
    draw();
    box.addEventListener("scroll", ask, { passive: true });
    // A finger dragging the list, or a wheel, lets go of the field.
    const byHand = () => {
      const field = bar.querySelector("input");
      if (document.activeElement !== field) return;
      handed.current = true;
      field?.blur();
    };
    // A press on a row is on its way somewhere: not a letting go to answer.
    const press = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("a, button")) pressed.current = Date.now();
    };
    box.addEventListener("touchmove", byHand, { passive: true });
    box.addEventListener("wheel", byHand, { passive: true });
    box.addEventListener("pointerdown", press, { passive: true });
    // What sits above the card comes and goes without a scroll.
    const sizes = new ResizeObserver(ask);
    sizes.observe(banner);
    if (banner.parentElement) sizes.observe(banner.parentElement);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      box.removeEventListener("scroll", ask);
      box.removeEventListener("touchmove", byHand);
      box.removeEventListener("wheel", byHand);
      box.removeEventListener("pointerdown", press);
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

  // Let go of with nothing typed, at the base state or short of it (after the
  // menu, or a search cleared), the list glides back to its head and the bar
  // goes with it as the scroll's. Not when a finger on the list is what let go
  // — it is driving — nor on the way into a row. `closing` keeps the bar
  // counted as out until the list has arrived.
  const [closing, setClosing] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const settle = () => { stop.current?.(); stop.current = null; setClosing(false); };
  useEffect(() => () => stop.current?.(), []);
  const letGo = () => {
    setFocused(false);
    const box = dock.current?.parentElement?.querySelector<HTMLElement>(".scroll");
    const hand = handed.current;
    handed.current = false;
    if (query !== "" || hand || Date.now() - pressed.current < 700) return;
    if (!box || box.scrollTop === 0 || box.scrollTop > searchBase(box) + 1) return;
    setClosing(true);
    stop.current = glide(box, 0, () => { stop.current = null; setClosing(false); });
  };

  const on = out || held || closing;
  // A list too short to scroll to the base state is lent the room to
  // (`.searchroom`) once the bar is out, and keeps it until it is back at its
  // head with the bar away: taken any sooner, the list would drop there.
  onNow.current = on;
  useEffect(() => {
    if (on) setRoom(true);
    else if ((dock.current?.parentElement?.querySelector(".scroll")?.scrollTop ?? 0) <= 0) setRoom(false);
  }, [on]);
  return (
    <div className="searchdock" ref={dock} data-on={on ? "" : undefined} data-room={room || on ? "" : undefined} data-held={held ? "" : undefined}
      data-ease={ease ? "" : undefined} data-searching={query ? "" : undefined}>
      <div className="searchclip">
        <div className="searchbar" inert={!on}>
          <label className="field">
            <Icon name="search" size={15} className="muted" style={{ flex: "none" }} />
            <input value={query} onChange={(e) => onQuery(e.target.value)}
              placeholder={copy.group.search.field} aria-label={copy.group.search.field}
              inputMode="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off"
              autoComplete="off" spellCheck={false}
              onFocus={() => { settle(); setFocused(true); }} onBlur={letGo}
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
