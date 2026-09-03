"use client";

import { useRef, useState } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

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
 */
export function AddName({ placeholder, autoFocus, onAdd }: {
  placeholder: string;
  autoFocus?: boolean;
  onAdd: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const ready = value.trim().length > 0 && !busy;

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
    <form className="row addrow" onSubmit={(e) => void submit(e)}>
      <span className="avatar ghost"><Icon name="plus" size={15} /></span>
      <input ref={field} className="addname" value={value} placeholder={placeholder}
        aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
        enterKeyHint="done" onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="action" disabled={!ready}>{copy.act.add}</button>
    </form>
  );
}
