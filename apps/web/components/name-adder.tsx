"use client";
// Doc: docs/frontend.md#names

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { bringIntoView } from "./viewport";
import { copy } from "../lib/copy";
import { bandOf, useRefusal } from "../lib/refusal";
import { nearestOutOfView, scrollTarget } from "../lib/reveal";
import { glide } from "../lib/seek";
import { useHoldsWork } from "../lib/update";
import { nameTaken } from "@bida/core";
import { NO_AUTOFILL } from "../lib/autofill";
import { isTyping } from "../lib/viewport";

/**
 * Never a dialog: four names through a scrim is four round trips. A name is filed
 * by the plus, by leaving the field, and by the screen's own button before it
 * acts — people tap away from a name they have typed and expect it kept.
 */
export interface AddNameHandle {
  clear: () => void;
  /** Files what is typed, if it can be: a screen's button calls this first. */
  settle: () => Promise<Settled>;
}

/** `refused` is a name the list already holds: it stays in the row, warned. */
export type Settled = "empty" | "filed" | "refused";

export function AddName({
  placeholder, autoFocus, taken, onAdd, onTaken, handle, onDraft, flash = "", onFlashEnd,
}: {
  placeholder: string;
  autoFocus?: boolean;
  taken: readonly string[];
  onAdd: (name: string) => void | Promise<void>;
  /** A name the list holds is that person, not a refusal — the picker's list. */
  onTaken?: (name: string) => void;
  handle?: React.RefObject<AddNameHandle | null>;
  onDraft?: (name: string | null) => void;
  flash?: string;
  onFlashEnd?: (e?: React.AnimationEvent) => void;
}) {
  const [value, setValue] = useState("");
  useHoldsWork(value.trim() !== "");
  const field = useRef<HTMLInputElement>(null);
  const already = !onTaken && nameTaken(value, taken);
  const own = useRefusal();
  const blooming = flash || own.flash;
  const row = useRef<HTMLFormElement>(null);
  const warning = useRef<HTMLDivElement>(null);

  // The flash as drawn. A refusal nobody can see whole is a press that did
  // nothing, so the row and the line under it are glided into view first, and
  // bloom when they land (docs/refusals.md).
  const [shown, setShown] = useState("");
  useLayoutEffect(() => {
    const box = row.current?.closest<HTMLElement>(".scroll");
    if (!blooming || !box || !row.current) { setShown(blooming); return; }
    const top = row.current.getBoundingClientRect().top;
    const bottom = (warning.current ?? row.current).getBoundingClientRect().bottom;
    const reach = nearestOutOfView([{ top, bottom }], bandOf(box));
    const target = reach === null ? null : scrollTarget(box, reach);
    if (target === null || target === box.scrollTop) { setShown(blooming); return; }
    setShown("");
    return glide(box, target, () => setShown(blooming));
  }, [blooming]);

  // What the field holds this instant, and a filing still on its way. A blur
  // files from a closure that may predate the screen's button filing — or a
  // picked row clearing — the same name.
  const now = useRef("");
  const filing = useRef<Promise<Settled> | null>(null);
  function put(next: string) {
    now.current = next;
    setValue(next);
  }

  function typed(next: string) {
    if (blooming) { own.onFlashEnd(); onFlashEnd?.(); }
    put(next);
  }

  // Follow after the render that added the name, not in the handler — unless
  // the caret has gone to another field, which the screen must not be dragged
  // away from by a name filed on the way out of this one.
  const count = taken.length;
  const seen = useRef(count);
  useEffect(() => {
    const at = document.activeElement;
    if (count > seen.current && field.current && (at === field.current || !isTyping(at))) {
      bringIntoView(field.current);
    }
    seen.current = count;
  }, [count]);

  // The line arrives under a row the list has followed to its foot, so under
  // the fold: bring it up with the caret.
  useEffect(() => {
    if (already && warning.current && document.activeElement === field.current) {
      bringIntoView(warning.current);
    }
  }, [already]);

  const draft = value.trim().length > 0 ? value.trim() : null;
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (told.current === draft) return;
    told.current = draft;
    onDraft?.(draft);
  });

  async function file(name: string): Promise<Settled> {
    await onAdd(name);
    put("");
    return "filed";
  }

  function settle(): Promise<Settled> {
    if (filing.current) return filing.current;
    const name = now.current.trim();
    if (!name) return Promise.resolve("empty");
    if (nameTaken(name, taken)) {
      if (!onTaken) return Promise.resolve("refused");
      onTaken(name);
      put("");
      return Promise.resolve("filed");
    }
    const run = file(name).finally(() => { filing.current = null; });
    filing.current = run;
    return run;
  }

  // Re-hung every render, so the closure a screen or a blur calls is never a
  // render behind.
  const latest = useRef(settle);
  useEffect(() => {
    latest.current = settle;
    if (!handle) return;
    handle.current = { clear: () => put(""), settle };
    return () => { handle.current = null; };
  });

  // A mouse button down. Its press blurs the field on the way down, and a row
  // filed then moves the button before the click lands.
  const pressing = useRef(false);
  useEffect(() => {
    const down = () => { pressing.current = true; };
    const up = () => { pressing.current = false; };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);

  /**
   * Leaving files the name, after whatever press did the leaving has clicked —
   * that button may file or clear the row itself. A mouse's click follows its
   * `pointerup` in the same task; a tap's compatibility `mousedown`, which is
   * what blurs, comes after its `pointerup`, with the click in that task too.
   */
  function left() {
    const run = () => setTimeout(() => void latest.current());
    if (!pressing.current) { run(); return; }
    const done = () => {
      document.removeEventListener("pointerup", done, true);
      document.removeEventListener("pointercancel", done, true);
      run();
    };
    document.addEventListener("pointerup", done, true);
    document.addEventListener("pointercancel", done, true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await settle() === "refused") own.refuse();
    field.current?.focus();
  }

  const typing = value.length > 0;

  return (
    <>
      <form ref={row} className={`row addrow${typing ? " editing" : ""}${shown}`}
        onSubmit={(e) => void submit(e)} onClick={() => field.current?.focus()}
        onAnimationEnd={(e) => { own.onFlashEnd(e); onFlashEnd?.(e); }}>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          autoComplete={NO_AUTOFILL} enterKeyHint="done" onChange={(e) => typed(e.target.value)}
          onBlur={left} />
        {/* Not the field's name: two things called "Add someone" is one too many. */}
        <button type="submit" className="iconbtn" aria-label={copy.act.add}>
          <Icon name="plus" size={15} />
        </button>
      </form>
      {/* Boxed like the entry form's line over Save, and blooming with the row:
          it is what the refusal is about. */}
      {already ? (
        <div ref={warning} role="status" className={`splitfoot bad alone addwarn${shown}`}>
          <span>{copy.members.taken(value.trim())}</span>
        </div>
      ) : null}
    </>
  );
}
