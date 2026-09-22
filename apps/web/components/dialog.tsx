"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { mark } from "../lib/diag";
import { note, tracePress } from "../lib/press-trace";
import { keepsFocus } from "./bits";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/**
 * The app's own popup, in place of `prompt()` and `confirm()`, which arrive in
 * the browser's typeface with no room for the sentence naming what will
 * change ([ADR-0008](docs/decisions/0008-hand-rolled-interface.md)).
 *
 * A real `<dialog>` opened with `showModal()`, so focus, Escape and the inert
 * screen behind are the platform's job. The element fills the viewport and
 * carries the scrim, so "tapped outside the card" is a plain target check.
 */
export function Dialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const frame = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // The `close` listener below is hung once and outlives every render; the
  // handler it has to call is a new closure on each one.
  const closed = useRef(onClose);
  closed.current = onClose;

  useEffect(() => {
    const el = frame.current;
    if (!el || el.open) return;
    /**
     * **First, so the recorder is listening before anything it must explain** —
     * `showModal()` moves focus, which folds the keyboard and moves the card
     * (`--kb`, globals.css). Every way out notes itself, so a card that vanished
     * with no press behind it shows in the trace (lib/press-trace.ts).
     */
    const stop = tracePress("dialog.trace", title, () => {
      /**
       * **Where the card was when the finger landed, against what was on screen.**
       * The card is laid out in the layout viewport with the keyboard paid as
       * padding (`--kb`); while that payment is wrong the card sits over the keys
       * and taps never reach the page. It is wrong while a blurred field's keyboard
       * retracts, since `--kb` drops the moment focus leaves (lib/viewport.ts).
       */
      const box = card.current?.getBoundingClientRect();
      const view = window.visualViewport;
      if (!box || !view) return "";
      const top = Math.round(view.offsetTop);
      return `card ${Math.round(box.top)}-${Math.round(box.bottom)}`
        + ` visible ${top}-${Math.round(top + view.height)} of ${Math.round(window.innerHeight)}`;
    });
    /**
     * **Whoever shuts this element, the state drawing it hears about it.**
     *
     * A close request the browser won't let us refuse fires no `cancel`, so
     * `onCancel` never runs. Only a document with history-action activation may
     * refuse one, and on Android the back press that *opened* this dialog spent
     * it: the next press shuts it silently. Without this the screen still thinks
     * its dialog is up — on `/new`, every further back press is then ignored.
     */
    const heard = () => { note("close event"); closed.current(); };
    el.addEventListener("close", heard);
    mark("dialog.open", title);
    el.showModal();
    // A prompt opens on its field, old value selected, and so does a box asking
    // for several lines. **Every other dialog opens on nothing**, so a stray
    // Enter fires neither button.
    //
    // `showModal()` doesn't do that by itself: with no `autofocus` it focuses
    // the first focusable descendant — the rate editor would open with the
    // keyboard over the line saying what saving re-values. Focus goes to the
    // card instead, which keeps Escape and the tab ring.
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input[data-autofocus], textarea[data-autofocus]",
    );
    // Selected in a one-line field, to type over. Never in a multi-line box: a
    // typed bill is reopened to be corrected, not replaced.
    if (field) { field.focus(); if (field instanceof HTMLInputElement) field.select(); }
    else card.current?.focus();
    return () => {
      // **How it ended.** Still open as it goes is the app closing it; already
      // shut is the platform having taken it — the failure this listener is for.
      const how = el.open ? "dismissed" : "SHUT BY THE PLATFORM";
      mark("dialog.gone", `${title}  ${how}`);
      el.removeEventListener("close", heard);
      // Last, so the line it writes holds everything above it.
      note(`gone ${how}`);
      stop();
    };
  }, []);

  return (
    <dialog className="scrim" ref={frame} aria-label={title}
      onCancel={(e) => { note("cancel refused"); e.preventDefault(); onClose(); }}
      // The card is a child, so a press landing on the element itself landed on
      // the scrim. **mousedown, not click**: a drag that starts on the card and
      // ends outside it is not a tap outside it.
      onMouseDown={(e) => { if (e.target === frame.current) { note("scrim"); onClose(); } }}>
      <div className="dialog" role="document" ref={card} tabIndex={-1}>
        <h3 className="dtitle">{title}</h3>
        {children}
      </div>
    </dialog>
  );
}

/**
 * "Do this?" — with room for the paragraph saying what it does, which is what
 * `confirm()` never had. The button says the act, never "OK".
 */
export function ConfirmDialog({ title, confirm, danger, children, onConfirm, onClose }: {
  title: string;
  confirm: string;
  danger?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      {children ? <div className="dbody">{children}</div> : null}
      <div className="drow">
        <button className="btn btn-s" onClick={onClose} disabled={busy}>{copy.act.cancel}</button>
        <button className={`btn ${danger ? "btn-d" : "btn-p"}`} onClick={() => void go()} disabled={busy}>
          {busy ? <span className="spinner" /> : null}{confirm}
        </button>
      </div>
    </Dialog>
  );
}

/** One field and a button. Enter submits; an empty or invalid value can't. */
export function PromptDialog({
  title, placeholder, initial = "", confirm, hint, maxLength, autoCapitalize,
  clean = (v) => v, valid = (v) => v.trim().length > 0, onSubmit, onClose,
}: {
  title: string;
  placeholder?: string;
  initial?: string;
  confirm: string;
  hint?: ReactNode;
  maxLength?: number;
  autoCapitalize?: "none" | "words" | "characters";
  /** Applied on every keystroke, so what is shown is what will be submitted. */
  clean?: (value: string) => string;
  valid?: (value: string) => boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ok = valid(value);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try { await onSubmit(value.trim()); } finally { setBusy(false); }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => void go(e)}>
        <input className="dinput" data-autofocus="" value={value} placeholder={placeholder}
          aria-label={title} maxLength={maxLength} autoCapitalize={autoCapitalize}
          enterKeyHint="done" onChange={(e) => setValue(clean(e.target.value))} />
        {hint ? <div className="hint">{hint}</div> : null}
        <div className="drow">
          <button type="button" className="btn btn-s" onClick={onClose} disabled={busy}
            {...keepsFocus}>{copy.act.cancel}</button>
          <button type="submit" className="btn btn-p" disabled={!ok || busy} {...keepsFocus}>
            {busy ? <span className="spinner" /> : null}{confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Pick one of a handful of things, in place of a `<select>` — whose native
 * picker is the same intrusion as `prompt()` (ADR-0008). Ours is the app's
 * rows, so each can carry a `note`: what picking it does. The current choice
 * has a check and closes without calling back.
 */
export function ChoiceDialog<T extends string>({ title, options, value, onPick, onClose }: {
  title: string;
  options: { value: T; label: string; note?: string }[];
  value: T;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dlist" role="listbox" aria-label={title}>
        {options.map((o) => (
          <button key={o.value} type="button" className="drow-pick" role="option"
            aria-selected={o.value === value}
            onClick={() => { if (o.value !== value) onPick(o.value); onClose(); }}>
            <span className="rmain">
              <span className="rtitle">{o.label}</span>
              {o.note ? <span className="rmeta">{o.note}</span> : null}
            </span>
            {o.value === value ? <Icon name="check" size={15} /> : null}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
