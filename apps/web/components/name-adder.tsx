"use client";

import { useEffect, useRef, useState } from "react";
import { keepsFocus } from "./bits";
import { Icon } from "./icons";
import { bringIntoView } from "./viewport";
import { copy } from "../lib/copy";
import { useRefusal } from "../lib/refusal";
import { nameTaken } from "@bida/core";

/**
 * Adding people, in the list itself.
 *
 * **Never a dialog** — four names through a scrim is four round trips. The
 * list's last row *is* the field: Enter files the name and hands the caret
 * back. (A removal keeps its dialog: it has a consequence to state, ADR-0008.)
 *
 * **A name is filed when the plus is pressed, never when the field is left**:
 * on blur a name lands while you look elsewhere, and a screen can rewrite
 * itself between press and release.
 *
 * **The plus is never dead.** On an empty row it focuses the field. Its one
 * refusal is a name the list already holds (`core/names.ts` — same name, same
 * key): that name blooms, because editing it is the fix.
 *
 * **A screen's refusal blooms whatever has to change**, so `flash` is routed
 * here: Create over an unfiled name points at the plus; over a too-short list,
 * at the field (reddening the placeholder).
 *
 * **A keystroke ends any flash on this row** — typing is the fix — and tells
 * the flash's owner (`lib/refusal.ts`). The plus itself is never spent: the
 * next press has to file.
 *
 * While the field holds anything the row draws as a box (`globals.css`): the
 * name is *not* on the list yet.
 *
 * The row **follows the list down**, keeping the list's act in view below it
 * (`--act-below`, globals.css).
 */
export interface AddNameHandle {
  /** Throw away whatever is in the field, filing nothing. */
  clear: () => void;
}

export function AddName({
  placeholder, autoFocus, taken, onAdd, handle, onDraft, flash = "", onFlashEnd,
}: {
  placeholder: string;
  autoFocus?: boolean;
  /** The names already on the list. One of these cannot be filed again. */
  taken: readonly string[];
  onAdd: (name: string) => void | Promise<void>;
  /** For a screen that empties the row itself — picking a name says the typed
      one was a false start. */
  handle?: React.RefObject<AddNameHandle | null>;
  /** What the field is holding, or `null` when it is empty — so a screen that
      guards against losing what has been typed can count it. Nothing acts on
      it: an unfiled name is unfiled, and only the plus files. */
  onDraft?: (name: string | null) => void;
  /** A screen's refusal, blooming this row: on the plus when a name is waiting
      to be filed, on the placeholder when nothing is typed. Ends early, with no
      event, when a keystroke makes it moot (lib/refusal.ts). */
  flash?: string;
  onFlashEnd?: (e?: React.AnimationEvent) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const already = nameTaken(value, taken);
  const ready = value.trim().length > 0 && !already && !busy;
  // Its own refusal (a duplicate name) and a screen's `flash` are one
  // animation: whichever runs wins, and both hear it end. This component picks
  // where it lands — the plus or the field.
  const own = useRefusal();
  const blooming = flash || own.flash;
  const onField = !ready;

  // Typing is the fix arriving, so it ends the flash; both owners hear it.
  function typed(next: string) {
    if (blooming) { own.onFlashEnd(); onFlashEnd?.(); }
    setValue(next);
  }

  // The list grows above this row, so past a screenful the field is below the
  // fold. **Follow after the render that added the name, not in the handler**,
  // with `nearest`. The field is the target because the focus and keyboard
  // scrolls aim at it too, so one `scroll-margin-bottom` lines all three up
  // (`bringIntoView`, components/viewport.tsx).
  const count = taken.length;
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current && field.current) bringIntoView(field.current);
    seen.current = count;
  }, [count]);

  const draft = value.trim().length > 0 ? value.trim() : null;
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (told.current === draft) return;
    told.current = draft;
    onDraft?.(draft);
  });

  // Re-hung every render rather than memoised, so the closure a screen calls is
  // never one render behind the field it is meant to be reading.
  useEffect(() => {
    if (!handle) return;
    handle.current = { clear: () => setValue("") };
    return () => { handle.current = null; };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!ready) {
      // An empty row has nothing to refuse — focusing is the answer. A duplicate
      // name is the one refusal, and it blooms the name.
      if (value.trim().length > 0 && already) own.refuse();
      field.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onAdd(value.trim());
      setValue("");
    } finally {
      setBusy(false);
    }
    // The phone's keyboard closes with the caret, and the next name is the
    // overwhelmingly likely next act.
    field.current?.focus();
  }

  const typing = value.length > 0;

  return (
    <>
      {/* One `onAnimationEnd` for the row: the flash may run on the plus or
          the field, and the `::placeholder`'s bubbles here too, which the
          handlers ignore (`lib/refusal.ts`). */}
      <form className={`row addrow${typing ? " editing" : ""}${onField ? blooming : ""}`}
        onSubmit={(e) => void submit(e)} onClick={() => field.current?.focus()}
        onAnimationEnd={(e) => { own.onFlashEnd(e); onFlashEnd?.(e); }}>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          enterKeyHint="done" onChange={(e) => typed(e.target.value)} />
        {/* Labelled for what it does, not the field's name — two things called
            "Add someone" is one too many for a screen reader or a test.
            Keeps the field's focus (`keepsFocus`, components/bits.tsx): a
            keyboard shutting and reopening on the press is a flinch, and can
            swallow the press. */}
        <button type="submit" className={`iconbtn${onField ? "" : blooming}`} aria-label={copy.act.add}
          {...keepsFocus}>
          <Icon name="plus" size={15} />
        </button>
      </form>
      {/* Said under the box and aligned with the names above, so it reads as a
          note on the list rather than a new row in it. The disabled plus has
          already refused the name; this says why. */}
      {already ? <p className="failure addwarn">{copy.members.taken(value.trim())}</p> : null}
    </>
  );
}
