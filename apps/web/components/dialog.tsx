"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { mark } from "../lib/diag";
import { note, tracePress } from "../lib/press-trace";
import { keepsFocus } from "./bits";
import { Icon } from "./icons";
import { copy } from "../lib/copy";

/**
 * The app's own popup, in place of `prompt()` and `confirm()`.
 *
 * The browser's dialogs drop another app's typeface and buttons over this one,
 * announcing themselves as the browser asking, with a single line of text and
 * no room for the sentence naming what is about to change. This is drawn from
 * the same vocabulary as everything else — a scrim, a hairline card, the app's
 * buttons ([ADR-0008](docs/decisions/0008-hand-rolled-interface.md)).
 *
 * A real `<dialog>` opened with `showModal()`, so focus, Escape and the
 * inertness of the screen behind are the platform's job. The element fills the
 * viewport and carries the scrim itself, which makes "did they tap outside the
 * card" a plain target check.
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
     * **First, so the recorder is listening before anything below can be what
     * it has to explain** — `showModal()` moves focus, and moving focus off a
     * field folds the keyboard, which changes where this card is drawn
     * (`--kb`, globals.css).
     *
     * A dialog that refuses a run of taps is the report this exists for, and
     * it is the report a phone gives and a build machine never does. Every way
     * out notes itself, so a card that went away with no press behind it is
     * the trace with no reason at the end of it (lib/press-trace.ts).
     */
    const stop = tracePress("dialog.trace", title, () => {
      /**
       * **Where the card was when the finger landed, against what was on
       * screen.** A modal `<dialog>` is laid out in the *layout* viewport, and
       * the strip a keyboard covers is paid out of it as padding (`--kb`,
       * globals.css) — so a card drawn while that payment is wrong is centred
       * over the keys, and a tap aimed at its buttons never reaches the page at
       * all. No event says that happened; these four numbers do.
       *
       * The payment is wrong for as long as it takes a blurred field's keyboard
       * to retract, because `--kb` goes to zero the moment focus leaves the
       * field and `showModal()` moves focus off it (lib/viewport.ts).
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
     * `showModal()` registers a close watcher, and a close request the browser
     * will not let us refuse fires no `cancel` at all — the dialog simply
     * closes, and `onCancel` below never runs. Only a document holding
     * history-action activation may refuse one, and on Android the back press
     * that *opened* this dialog spent exactly that: the very next press shuts
     * it silently.
     *
     * Without this the element stays mounted and shut — invisible, while the
     * screen still believes its dialog is up. On `/new` that belief is the
     * answer every further back press gets (`ask` is already `"discard"`, so
     * setting it changes nothing and re-renders nothing) and the screen stops
     * answering the back button at all.
     */
    const heard = () => { note("close event"); closed.current(); };
    el.addEventListener("close", heard);
    mark("dialog.open", title);
    el.showModal();
    // A prompt opens on its field, with the old value selected — the one habit
    // worth keeping from prompt(). So does a box asking for several lines, where
    // the box *is* the dialog. **Every other dialog opens on nothing**: its
    // buttons are one Tab away and neither should fire on a stray Enter.
    //
    // That second half has to be said out loud: `showModal()` does not open on
    // nothing. With no `autofocus` in the card it focuses the first focusable
    // descendant, which in a dialog whose first control is a field is the field
    // — so the rate editor opens with the keyboard up over the line saying how
    // many entries saving re-values. Focus lands on the card instead, which is
    // inside the dialog (Escape and the tab ring still belong to it) and is not
    // something you can type into.
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input[data-autofocus], textarea[data-autofocus]",
    );
    // Selected in a field of one line, where the old value is a word to type
    // over. Never in a box of several: a bill somebody typed is reopened to be
    // corrected, and the first keystroke would take the whole of it.
    if (field) { field.focus(); if (field instanceof HTMLInputElement) field.select(); }
    else card.current?.focus();
    return () => {
      // **How it ended, which is the whole question on a phone.** Still open
      // as it goes is the app closing it — a tap on Cancel or the scrim, or a
      // close request we were allowed to refuse. Already shut is the platform
      // having taken it, which is the failure this listener exists for.
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
 * Pick one of a handful of things — the third dialog, in place of a `<select>`.
 *
 * A native picker is the same intrusion `prompt()` is (ADR-0008): on a phone a
 * full-height wheel or sheet in the OS's typeface, showing a name and nothing
 * else. Ours is the rows the rest of the app is made of, so a row can say what
 * the caller needs to say about it.
 *
 * `note` is that sentence — what picking this one does, when it isn't simply
 * "this one now". The current choice carries a check and closes the dialog
 * without calling back.
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
