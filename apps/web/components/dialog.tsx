"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { mark } from "../lib/diag";
import { useHoldsWork } from "../lib/update";
import { note, tracePress } from "../lib/press-trace";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { NO_AUTOFILL } from "../lib/autofill";

/**
 * A real `<dialog>` opened with `showModal()`: focus, Escape and the inert screen
 * behind are the platform's job
 * ([ADR-0008](docs/decisions/0008-hand-rolled-interface.md)).
 */
export function Dialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const frame = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const closed = useRef(onClose);
  closed.current = onClose;
  useHoldsWork(true);

  useEffect(() => {
    const el = frame.current;
    if (!el || el.open) return;
    /**
     * First, so the recorder is listening before `showModal()` folds the
     * keyboard.
     */
    const stop = tracePress("dialog.trace", title, () => {
      /**
       * Where the card was when the finger landed: while `--kb` is wrong the card
       * sits over the keys and taps never reach the page.
       */
      const box = card.current?.getBoundingClientRect();
      const view = window.visualViewport;
      if (!box || !view) return "";
      const top = Math.round(view.offsetTop);
      return `card ${Math.round(box.top)}-${Math.round(box.bottom)}`
        + ` visible ${top}-${Math.round(top + view.height)} of ${Math.round(window.innerHeight)}`;
    });
    /**
     * A close request the browser won't let us refuse fires no `cancel`: on
     * Android the back press that opened this dialog spent its activation.
     * Without this the screen still thinks its dialog is up.
     */
    const heard = () => { note("close event"); closed.current(); };
    el.addEventListener("close", heard);
    mark("dialog.open", title);
    el.showModal();
    // Only a prompt opens on its field; every other dialog focuses the card, so a
    // stray Enter fires neither button and no keyboard covers the text.
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input[data-autofocus], textarea[data-autofocus]",
    );
    // Selected, so typing replaces what is there; never a multi-line box.
    if (field) { field.focus(); if (field instanceof HTMLInputElement) field.select(); }
    else card.current?.focus();
    return () => {
      const how = el.open ? "dismissed" : "SHUT BY THE PLATFORM";
      mark("dialog.gone", `${title}  ${how}`);
      el.removeEventListener("close", heard);
      note(`gone ${how}`);
      stop();
    };
  }, []);

  return (
    <dialog className="scrim" ref={frame} aria-label={title}
      onCancel={(e) => { note("cancel refused"); e.preventDefault(); onClose(); }}
      // mousedown, not click: a drag that starts on the card is not a tap outside
      // it.
      onMouseDown={(e) => { if (e.target === frame.current) { note("scrim"); onClose(); } }}>
      <div className="dialog" role="document" ref={card} tabIndex={-1}>
        <h3 className="dtitle">{title}</h3>
        {children}
      </div>
    </dialog>
  );
}

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

export function NoticeDialog({ title, onClose, children, list, button = copy.act.close }: {
  title: string; onClose: () => void; children: ReactNode; list?: ReactNode; button?: string;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dbody">{children}</div>
      {list === undefined ? null : <div className="dlist">{list}</div>}
      <div className="drow">
        <button className="btn btn-p" onClick={onClose}>{button}</button>
      </div>
    </Dialog>
  );
}

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
          autoComplete={NO_AUTOFILL} enterKeyHint="done" onChange={(e) => setValue(clean(e.target.value))} />
        {hint ? <div className="hint">{hint}</div> : null}
        <div className="drow">
          <button type="button" className="btn btn-s" onClick={onClose} disabled={busy}>{copy.act.cancel}</button>
          <button type="submit" className="btn btn-p" disabled={!ok || busy}>
            {busy ? <span className="spinner" /> : null}{confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * In place of a `<select>`, whose native picker is the intrusion `prompt()` is.
 */
export function ChoiceDialog<T extends string>({ title, options, value, onPick, onClose, lead, head, empty }: {
  title: string;
  options: { value: T; label: string; note?: string; you?: boolean }[];
  value: T;
  onPick: (value: T) => void;
  onClose: () => void;
  lead?: { label: string; onPick: () => void; disabled?: boolean; note?: string };
  /** Over the list: a search narrowing it. */
  head?: ReactNode;
  /** In place of a list narrowed to nothing. */
  empty?: ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      {head}
      <div className="dlist" role="listbox" aria-label={title}>
        {lead ? (
          <button type="button" className="drow-pick lead" role="option" aria-selected={false}
            disabled={lead.disabled} aria-disabled={lead.disabled}
            onClick={() => { onClose(); lead.onPick(); }}>
            <span className="rmain">
              <span className="rtitle">{lead.label}</span>
              {lead.note ? <span className="rmeta">{lead.note}</span> : null}
            </span>
            <Icon name="chev" size={13} className="spacer muted" />
          </button>
        ) : null}
        {options.length === 0 && !lead ? empty : null}
        {options.map((o) => (
          <button key={o.value} type="button" className="drow-pick" role="option"
            aria-selected={o.value === value}
            onClick={() => { if (o.value !== value) onPick(o.value); onClose(); }}>
            <span className="rmain">
              <span className="rtitle">
                {o.label}{o.you ? <span className="youtag"> ({copy.entry.you})</span> : null}
              </span>
              {o.note ? <span className="rmeta">{o.note}</span> : null}
            </span>
            {o.value === value ? <Icon name="check" size={15} /> : null}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
