"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { nameTaken } from "@hajsik/core";

/**
 * Adding people, in the list itself.
 *
 * This was a `PromptDialog`, and a dialog is the wrong shape for it: nobody
 * adds one person. Four names meant four round trips through a scrim — open,
 * type, confirm, watch it close — when the act is simply typing. Here the last
 * row of the list *is* the field: Enter files the name and hands the caret
 * back, so a group of six is one uninterrupted burst of typing — and while what
 * is typed is fileable the next empty row is already drawn underneath, so a
 * finger has that same one-tap route where it has no Enter to reach for.
 *
 * The dialogs stay where they belong (ADR-0008) — a rename is one field and
 * one name, and a removal has a consequence to state first.
 *
 * **Leaving the field files the name too.** An "Add" button beside a field you
 * have just finished typing into is a second way to say the thing you already
 * said, and the one people don't say: they tab away, or reach for Create, and
 * watch the name they typed not be there. So the row commits on blur, and the
 * button is gone. What it leaves behind is the row's shape — text on the left,
 * one control on the right, exactly like the member rows above it: a `plus`
 * while the field is empty, which focuses it, and a `trash` the moment there is
 * something to throw away, which is the only way back out of a row that will
 * otherwise file itself.
 *
 * Two things follow from the field living inside the list it fills. A name
 * already on that list is refused here rather than added twice (core/names.ts),
 * said as it is typed — and, since blur can no longer be the thing that catches
 * it, a refused name simply stays in the field with its warning rather than
 * being filed or dropped. And each name pushes this row further down, so the
 * field follows the list rather than walking off the bottom of it.
 */
export interface AddNameHandle<T> {
  /** Throw away whatever is in the field, filing nothing. */
  clear: () => void;
  /**
   * File whatever is still in the field, and resolve once it is written.
   *
   * Blur fires before the click that caused it, so a screen's own button —
   * Create, Continue — would otherwise race the name being typed as it was
   * pressed. Pressing it awaits this instead. Resolves to whatever `onAdd`
   * returned, or `null` when the field held nothing to file.
   */
  flush: () => Promise<T | null>;
}

export function AddName<T>({ placeholder, autoFocus, taken, duplicates = "refuse", onAdd, handle,
  onDraft }: {
  placeholder: string;
  autoFocus?: boolean;
  /** The names already on the list. */
  taken: readonly string[];
  /**
   * What a name already on that list means here.
   *
   * `refuse` on a list you are filling: two people with one name are two people
   * nothing on screen tells apart (core/names.ts). `match` on a list you are
   * picking yourself out of, where typing a name that is already there is a
   * hit rather than a collision — you are the Ana somebody added while you were
   * on the train, and being told to add an initial is the wrong answer to that.
   * It costs nothing, because the name *is* the id: adding an Ana who exists
   * resolves to her (`memberIdFor`).
   */
  duplicates?: "refuse" | "match";
  onAdd: (name: string) => T | Promise<T>;
  /** For the screen's own button to commit the field before it acts. */
  handle?: React.RefObject<AddNameHandle<T> | null>;
  /** The name this row would file right now, or `null` for nothing fileable —
      so a screen whose button acts on it can say so before it is pressed. */
  onDraft?: (name: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLFormElement>(null);
  const already = duplicates === "refuse" && nameTaken(value, taken);
  const ready = value.trim().length > 0 && !already && !busy;

  // The list grows above this row, so past a screenful the field is below the
  // fold and the rest of the names are typed blind — the browser scrolls to a
  // field when it takes focus, and this one never loses it. Follow the row
  // once it has actually moved: after the render that added the name, not in
  // the handler that asked for it. `nearest` scrolls the least that works, so
  // a field already in view doesn't jump.
  const count = taken.length;
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) row.current?.scrollIntoView({ block: "nearest" });
    seen.current = count;
  }, [count]);

  // What pressing the screen's own button would file. A name already on the
  // list is not it: the row refuses that one, so nothing downstream should
  // offer to act on it.
  const draft = value.trim().length > 0 && !already ? value.trim() : null;
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (told.current === draft) return;
    told.current = draft;
    onDraft?.(draft);
  });

  // What the last keystroke's worth of typing turned into. A screen's button
  // asks for this *after* the blur its own press caused has already filed the
  // name and emptied the field — so a flush that finds nothing to do answers
  // with what the blur just did rather than with silence, which is the
  // difference between "Continue as Marie" continuing as Marie and continuing
  // as whoever happened to be ticked. Typing again makes it history.
  const filed = useRef<Promise<T | null> | null>(null);

  function commit(): Promise<T | null> {
    if (!ready) return filed.current ?? Promise.resolve(null);
    const run = (async () => {
      setBusy(true);
      try {
        const added = await onAdd(value.trim());
        setValue("");
        return added;
      } finally {
        setBusy(false);
      }
    })();
    filed.current = run;
    return run;
  }

  // Re-hung every render rather than memoised, so the closure a screen calls is
  // never one render behind the field it is meant to be reading.
  useEffect(() => {
    if (!handle) return;
    handle.current = {
      flush: commit,
      clear: () => { filed.current = null; setValue(""); },
    };
    return () => { handle.current = null; };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await commit();
    // The phone's keyboard closes with the caret, and the next name is the
    // overwhelmingly likely next act. Only on Enter: leaving the field is the
    // other way to file a name, and taking focus back would be refusing to let
    // the person leave.
    field.current?.focus();
  }

  const typing = value.length > 0;

  return (
    <>
      <form ref={row} className="row addrow" onSubmit={(e) => void submit(e)}
        onClick={() => field.current?.focus()}>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          enterKeyHint="done" onBlur={() => void commit()}
          onChange={(e) => { filed.current = null; setValue(e.target.value); }} />
        {/* Never lets the field go: this button's whole job is to stop a name
            being filed, and a blur is what files one.

            Empty, it is hidden from assistive tech rather than labelled: it
            only focuses the field beside it, which a screen reader has already
            reached and named, and two things answering to "Add someone" is one
            too many. With something to throw away it is a real act, so it says
            so. */}
        <button type="button" className="iconbtn" aria-label={typing ? copy.act.clear : undefined}
          aria-hidden={typing ? undefined : true} tabIndex={typing ? undefined : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setValue(""); field.current?.focus(); }}>
          <Icon name={typing ? "trash" : "plus"} size={typing ? 14 : 15} />
        </button>
      </form>
      {already ? <p className="failure addwarn">{copy.members.taken(value.trim())}</p> : null}

      {/* The touch route to a second name. Enter files one and so does leaving
          the field, and a finger has neither: on a phone there is no keyboard
          Enter worth reaching for and nowhere neutral to tap that isn't also a
          name. So the row this one is about to become appears underneath while
          what is typed is fileable — tapping it files the name and hands the
          caret back, which is exactly what Enter does.

          Only on a list you are filling. The offer it makes is "and another",
          which on a list you are picking yourself out of is an offer to have a
          second name — so `duplicates` decides this too.

          Hidden from assistive tech, like the plus beside the field and for the
          same reason: it answers to the field's own name, and Enter is already
          there for anyone not tapping. */}
      {draft && duplicates === "refuse" ? (
        <button type="button" className="row addnext" aria-hidden={true} tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { void commit(); field.current?.focus(); }}>
          <span className="addname">{placeholder}</span>
          <span className="iconbtn"><Icon name="plus" size={15} /></span>
        </button>
      ) : null}
    </>
  );
}
