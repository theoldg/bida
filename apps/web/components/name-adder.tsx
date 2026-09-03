"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { nameTaken } from "../lib/names";

/**
 * Adding people, in the list itself.
 *
 * This was a `PromptDialog`, and a dialog is the wrong shape for it: nobody
 * adds one person. Four names meant four round trips through a scrim — open,
 * type, confirm, watch it close — when the act is simply typing. Here the last
 * row of the list *is* the field: Enter files the name and hands the caret
 * back, so a group of six is one uninterrupted burst of typing.
 *
 * The dialogs stay where they belong (ADR-0008) — a rename is one field and
 * one name, and a removal has a consequence to state first.
 *
 * Two things follow from the field living inside the list it fills. A name
 * already on that list is refused here rather than added twice (lib/names.ts),
 * said as it is typed and not after the fact. And each name pushes this row
 * further down, so the field follows the list rather than walking off the
 * bottom of it.
 */
export function AddName({ placeholder, autoFocus, taken, onAdd }: {
  placeholder: string;
  autoFocus?: boolean;
  /** The names already on the list — this row won't add a second of any. */
  taken: readonly string[];
  onAdd: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLFormElement>(null);
  const already = nameTaken(value, taken);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await onAdd(value.trim());
      setValue("");
    } finally {
      setBusy(false);
      // The phone's keyboard closes with the caret, and the next name is the
      // overwhelmingly likely next act.
      field.current?.focus();
    }
  }

  return (
    <>
      <form ref={row} className="row addrow" onSubmit={(e) => void submit(e)}>
        <span className="avatar ghost"><Icon name="plus" size={15} /></span>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          enterKeyHint="done" onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="action" disabled={!ready}>{copy.act.add}</button>
      </form>
      {already ? <p className="failure addwarn">{copy.members.taken(value.trim())}</p> : null}
    </>
  );
}
