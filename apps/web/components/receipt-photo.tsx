"use client";
// Doc: docs/photos.md

import { useEffect, useRef, useState } from "react";
import { copy } from "../lib/copy";
import { mark } from "../lib/diag";
import { useHoldsWork } from "../lib/update";
import { Icon } from "./icons";

/**
 * The entry form's Photo row: what it shows is what Save keeps. There is no
 * row without a photo, and nothing here changes one — only a scan does.
 */
export function PhotoField({ photo }: {
  /** Undefined is none; a `src`-less one is kept but still on its way here. */
  photo: { src?: string } | undefined;
}) {
  if (!photo) return null;
  return (
    <div className="field photofield">
      <span className="fieldlabel">{copy.photo.label}</span>
      <PhotoThumb src={photo.src} />
    </div>
  );
}

/**
 * A kept receipt as a miniature, and a tap away the whole of it. The miniature
 * shows the head of the bill, where the name is; the viewer shows it at the
 * screen's width and scrolls a till roll down, since a photo under a megapixel
 * already has no more to give a zoom.
 */
export function PhotoThumb({ src, className = "" }: { src?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  // Kept on another phone and not here yet: the frame it will land in.
  if (!src) return <span className={`photothumb waiting ${className}`} role="img" aria-label={copy.photo.waiting} />;
  return <>
    <button type="button" className={`photothumb ${className}`} aria-label={copy.photo.view}
      onClick={() => setOpen(true)}>
      <img src={src} alt="" draggable={false} />
    </button>
    {open ? <PhotoViewer src={src} onClose={() => setOpen(false)} /> : null}
  </>;
}

/**
 * A real `<dialog>`, like `Dialog`, so the device's back closes it — but no
 * card: the photo is the whole screen, on a dark ground in both themes, where
 * white paper has an edge.
 */
function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const frame = useRef<HTMLDialogElement>(null);
  const closed = useRef(onClose);
  closed.current = onClose;
  useHoldsWork(true);

  useEffect(() => {
    const el = frame.current;
    if (!el || el.open) return;
    // A close the browser won't let us refuse fires no `cancel` (Dialog's reason).
    const heard = () => closed.current();
    el.addEventListener("close", heard);
    mark("dialog.open", "photo");
    el.showModal();
    return () => el.removeEventListener("close", heard);
  }, []);

  return (
    <dialog className="photoview" ref={frame} aria-label={copy.photo.title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A tap anywhere puts it away; a drag scrolls and brings no click.
      onClick={onClose}>
      <div className="photoframe">
        <img src={src} alt={copy.photo.title} draggable={false} />
      </div>
      <button type="button" className="photoclose" aria-label={copy.act.close}>
        <Icon name="cross" size={14} />
      </button>
    </dialog>
  );
}
