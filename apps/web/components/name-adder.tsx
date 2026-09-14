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
 * This was a `PromptDialog`, and a dialog is the wrong shape for it: nobody
 * adds one person. Four names meant four round trips through a scrim — open,
 * type, confirm, watch it close — when the act is simply typing. Here the last
 * row of the list *is* the field: Enter files the name and hands the caret
 * back, so a group of six is one uninterrupted burst of typing.
 *
 * The dialogs stay where they belong (ADR-0008) — a removal has a consequence
 * to state first.
 *
 * **A name is filed when it is pressed, never when the field is left.** Blur
 * once filed it, so a name could land while you were looking at something else
 * and a screen could rewrite itself between a press and its release. It is the
 * plus on the right of the row that files — the same button a finger presses,
 * a keyboard reaches with Enter, and a screen reader announces.
 *
 * **The plus is never dead**, and on an empty row it does not refuse either —
 * it focuses the field. A control that looks like a button and answers nothing
 * reads as a broken app, but there is nothing to say no *about* before a name
 * is typed: the keyboard opening is the answer, and the same button files what
 * gets typed into it. The one press of it that refuses is a name the list
 * already holds (`core/names.ts` — two people with one name are two people
 * nothing on screen tells apart, and the same key besides): that name blooms,
 * because editing it is the fix and no press will ever file it, and the note
 * under the row says so in words.
 *
 * **A screen's refusal blooms whatever has to change**, which is why `flash`
 * is routed here rather than hung on one control: a Create pressed over an
 * unfiled name points at the plus, the whole of that fix, and one pressed over
 * a list too short to go on with points at the field, where the missing name
 * has to be typed. That second case is the only thing that reddens the
 * placeholder — the plus's own press never does.
 *
 * **A keystroke ends any flash on this row**, rather than leaving it to run
 * out: typing *is* the fix landing, and a placeholder that has just been typed
 * over cannot carry a refusal anyway. Whoever owns the flash is told
 * (`lib/refusal.ts`), because a control spent for the length of one is spent
 * until it hears the end.
 *
 * Unlike Create, the plus is *not* spent for the length of a flash: the fix is
 * a keystroke away and the very next press of it has to file.
 *
 * While the field holds anything, the row draws itself as a box
 * (`globals.css`) — because a name sitting in it is *not* on the list yet, and
 * a row that looks exactly like the committed rows above it says the opposite.
 * The box is the difference between typed and filed, made visible.
 *
 * The row **follows the list down**, as a browser scrolls to a field only as it
 * takes focus, and this one never lets go — far enough down to keep the act the
 * list ends on in view with it, rather than flush against the keyboard with
 * that act behind one (`--act-below`, globals.css).
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
  /** For a screen that wants to empty the row on its own — picking a name is
      the plainest way of saying the one being typed was a false start. */
  handle?: React.RefObject<AddNameHandle | null>;
  /** What the field is holding, or `null` when it is empty — so a screen that
      guards against losing what has been typed can count it. Nothing acts on
      it: an unfiled name is unfiled, and only the plus files. */
  onDraft?: (name: string | null) => void;
  /** A screen's refusal, blooming this row: the name it is missing is the one
      in this field, whether that is a name nobody has filed — the plus is the
      whole of that fix — or a name nobody has typed, which reddens the
      placeholder instead. Ends early, with no event, when a keystroke makes it
      moot (lib/refusal.ts). */
  flash?: string;
  onFlashEnd?: (e?: React.AnimationEvent) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const already = nameTaken(value, taken);
  const ready = value.trim().length > 0 && !already && !busy;
  // Its own refusal, for the one press it has to say no to: a name already on
  // the list. A screen's `flash` blooms this row for its own reasons, and the
  // two are one animation: whichever is running wins, and both hear it end.
  // Where it lands is this component's to decide — the plus when a good name
  // is waiting to be filed, the field when the field is what's wrong.
  const own = useRefusal();
  const blooming = flash || own.flash;
  const onField = !ready;

  // Typing is the fix arriving, so it ends the flash rather than letting it
  // run out under the keystrokes. Both owners hear it: `own` for the duplicate
  // it refused, the screen for the refusal it is spending a button on.
  function typed(next: string) {
    if (blooming) { own.onFlashEnd(); onFlashEnd?.(); }
    setValue(next);
  }

  // The list grows above this row, so past a screenful the field is below the
  // fold and the rest of the names are typed blind — the browser scrolls to a
  // field when it takes focus, and this one never loses it. Follow it once it
  // has actually moved: after the render that added the name, not in the
  // handler that asked for it. `nearest` scrolls the least that works, so a
  // field already in view doesn't jump.
  //
  // The field rather than the row, because the browser's own scroll on focus
  // and the one the keyboard opening makes both aim at the field: one target,
  // one `scroll-margin-bottom`, and three scrolls that land in the same place —
  // far enough down that the act the list ends on comes up too
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
      // An empty row has nothing to refuse — the caret is the whole answer,
      // and the next press of this same plus files what was typed. A name the
      // list already holds is the one press that says no, and it says it on
      // the name, which is what has to change.
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
      {/* One `onAnimationEnd` for the row, because the flash may be running on
          either the plus or the field and both bubble to here — including the
          `::placeholder`'s, which the handlers below know to ignore
          (`lib/refusal.ts`). */}
      <form className={`row addrow${typing ? " editing" : ""}${onField ? blooming : ""}`}
        onSubmit={(e) => void submit(e)} onClick={() => field.current?.focus()}
        onAnimationEnd={(e) => { own.onFlashEnd(e); onFlashEnd?.(e); }}>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          enterKeyHint="done" onChange={(e) => typed(e.target.value)} />
        {/* The one way a name gets filed, so it says what it does rather than
            answering to the field's own name — two things called "Add someone"
            is one too many, for a screen reader and for a test alike.

            It keeps the field's focus (`keepsFocus`, components/bits.tsx):
            nothing is filed by a blur any more, but a keyboard that shuts on
            the press and reopens on the refocus is a flinch under the thumb —
            and a press spent closing one is a press that never lands. */}
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
