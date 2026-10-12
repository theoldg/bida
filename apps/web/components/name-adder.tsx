"use client";
// Doc: docs/frontend.md#names

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { bringIntoView } from "./viewport";
import { copy } from "../lib/copy";
import { useRefusal } from "../lib/refusal";
import { useHoldsWork } from "../lib/update";
import { nameTaken } from "@bida/core";

/**
 * Never a dialog: four names through a scrim is four round trips. A name is filed
 * when the plus is pressed, never when the field is left — on blur a name lands
 * while you look elsewhere.
 */
export interface AddNameHandle {
  clear: () => void;
}

export function AddName({
  placeholder, autoFocus, taken, onAdd, handle, onDraft, flash = "", onFlashEnd,
}: {
  placeholder: string;
  autoFocus?: boolean;
  taken: readonly string[];
  onAdd: (name: string) => void | Promise<void>;
  handle?: React.RefObject<AddNameHandle | null>;
  onDraft?: (name: string | null) => void;
  flash?: string;
  onFlashEnd?: (e?: React.AnimationEvent) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useHoldsWork(value.trim() !== "");
  const field = useRef<HTMLInputElement>(null);
  const already = nameTaken(value, taken);
  const ready = value.trim().length > 0 && !already && !busy;
  const own = useRefusal();
  const blooming = flash || own.flash;
  const onField = !ready;

  function typed(next: string) {
    if (blooming) { own.onFlashEnd(); onFlashEnd?.(); }
    setValue(next);
  }

  // Follow after the render that added the name, not in the handler.
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

  // Re-hung every render, so the closure a screen calls is never a render behind.
  useEffect(() => {
    if (!handle) return;
    handle.current = { clear: () => setValue("") };
    return () => { handle.current = null; };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!ready) {
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
    field.current?.focus();
  }

  const typing = value.length > 0;

  return (
    <>
      <form className={`row addrow${typing ? " editing" : ""}${onField ? blooming : ""}`}
        onSubmit={(e) => void submit(e)} onClick={() => field.current?.focus()}
        onAnimationEnd={(e) => { own.onFlashEnd(e); onFlashEnd?.(e); }}>
        <input ref={field} className="addname" value={value} placeholder={placeholder}
          aria-label={placeholder} maxLength={40} autoCapitalize="words" autoFocus={autoFocus}
          enterKeyHint="done" onChange={(e) => typed(e.target.value)} />
        {/* Not the field's name: two things called "Add someone" is one too many. */}
        <button type="submit" className={`iconbtn${onField ? "" : blooming}`} aria-label={copy.act.add}>
          <Icon name="plus" size={15} />
        </button>
      </form>
      {already ? <p className="failure addwarn">{copy.members.taken(value.trim())}</p> : null}
    </>
  );
}
