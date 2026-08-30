"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The app's own popup, in place of `prompt()` and `confirm()`.
 *
 * The browser's dialogs were the one place the design didn't reach: another
 * app's typeface and buttons dropped over this one, announcing themselves as
 * the browser asking rather than the app, with a single line of text and no
 * room for the sentence that names what is about to change. This one is drawn
 * from the same vocabulary as everything else — a scrim, a hairline card, the
 * app's buttons ([ADR-0025](docs/decisions/0025-our-own-dialogs.md)).
 *
 * It is a real `<dialog>` opened with `showModal()`, so focus, Escape and the
 * inertness of the screen behind are the platform's job and not ours. The
 * element fills the viewport and carries the scrim itself, which is what makes
 * "did they tap outside the card" a plain target check.
 */
export function Dialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const frame = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el || el.open) return;
    el.showModal();
    // A prompt opens on its field, with the old value selected — the one habit
    // worth keeping from prompt(). A confirm opens on nothing, deliberately:
    // its buttons are one Tab away and neither should fire on a stray Enter.
    const field = el.querySelector<HTMLInputElement>("input[data-autofocus]");
    if (field) { field.focus(); field.select(); }
  }, []);

  return (
    <dialog className="scrim" ref={frame} aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // The card is a child, so a press landing on the element itself landed on
      // the scrim. mousedown, not click: a drag that starts on the card and
      // ends outside it isn't a tap outside it.
      onMouseDown={(e) => { if (e.target === frame.current) onClose(); }}>
      <div className="dialog" role="document">
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
        <button className="btn btn-s" onClick={onClose} disabled={busy}>Cancel</button>
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
          <button type="button" className="btn btn-s" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={!ok || busy}>
            {busy ? <span className="spinner" /> : null}{confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
