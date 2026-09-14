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
 * **The plus is never dead.** It was `disabled` while there was nothing to
 * file, and a control that looks like a button and answers nothing reads as a
 * broken app rather than as a refusal. So it presses like Create and the quick
 * split's scan pair do: a press that cannot go through blooms and puts the
 * caret back in the field (`lib/refusal.ts`), filing nothing either way.
 *
 * **The bloom lands on whatever has to change** — a refusal points, and this
 * row has two things to point at. The plus is the fix only when the name in
 * the field is good and unfiled; then pressing it is the whole of the answer,
 * and it is what blooms, for this row's own refusals and for a screen's alike.
 * When the *field* is the problem the field blooms instead: an empty row
 * reddens "Add someone" itself, because what is missing is a name and no
 * number of presses will produce one, and a name the list already holds
 * reddens the typed name, because that name is what has to be edited
 * (`core/names.ts` — two people with one name are two people nothing on screen
 * tells apart, and the same key besides; the note under the row says so in
 * words).
 *
 * Unlike Create, the plus is *not* spent for the length of its own flash: the
 * fix is a keystroke away and the very next press of it has to file, so a
 * second refusal restarts the flash instead of being swallowed.
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
      whole of that fix — or a name nobody has typed, which blooms the field
      instead (lib/refusal.ts). */
  flash?: string;
  onFlashEnd?: (e: React.AnimationEvent) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const already = nameTaken(value, taken);
  const ready = value.trim().length > 0 && !already && !busy;
  // Its own refusal, for a press with nothing fileable under it. A screen's
  // `flash` blooms this row for its own reasons, and the two are one
  // animation: whichever is running wins, and both hear it end. Where it lands
  // is this component's to decide — the plus when a good name is waiting to be
  // filed, the field when the field is what's wrong.
  const own = useRefusal();
  const blooming = flash || own.flash;
  const onField = !ready;

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
      // Nothing to file. The bloom lands on the field (see above), so hand the
      // caret back with it: both fixes are typed, not pressed.
      own.refuse();
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
          enterKeyHint="done" onChange={(e) => setValue(e.target.value)} />
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
