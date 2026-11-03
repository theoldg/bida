"use client";
// Doc: docs/photos.md

import { useEffect, useRef, useState } from "react";
import { copy } from "../lib/copy";
import { keepNote, mark } from "../lib/diag";
import { errorText } from "../lib/format";
import { downscaleToBase64Jpeg } from "../lib/scan/downscale";
import { warmBillFinder } from "../lib/scan/find-bill";
import { useHoldsWork } from "../lib/update";
import { Icon } from "./icons";

/**
 * The entry form's Photo row: what it shows is what Save keeps. Empty, it is
 * one slim row that attaches a photo; full, the miniature and a way to clear
 * it. A photo attached by hand goes through the scan's own crop and nothing
 * else — it is never read, so the bill's items stay as they are.
 */
export function PhotoField({ photo, onAttach, onClear }: {
  /** Undefined is none; a `src`-less one is kept but still on its way here. */
  photo: { src?: string } | undefined;
  onAttach: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState(false);

  const picked = async (file: File | undefined) => {
    if (!file) return;
    setCropping(true);
    try {
      onAttach(`data:image/jpeg;base64,${await downscaleToBase64Jpeg(file)}`);
    } catch (err) {
      keepNote("photo", errorText(err));
    } finally {
      setCropping(false);
    }
  };

  const chooser = (
    // No `capture`: the phone offers the camera and the library both.
    <input ref={input} type="file" accept="image/*" style={{ display: "none" }} aria-label={copy.photo.attach}
      onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void picked(file); }} />
  );

  if (!photo && !cropping) {
    return (
      <div className="field photofield">
        <span className="fieldlabel">{copy.photo.label}</span>
        <button type="button" className="pick" aria-label={copy.photo.attach}
          onClick={() => { void warmBillFinder(); input.current?.click(); }}>
          <Icon name="attach" size={18} className="pchev" />
        </button>
        {chooser}
      </div>
    );
  }
  return (
    <div className="field photofield full">
      <span className="fieldlabel">{copy.photo.label}</span>
      <PhotoThumb src={cropping ? undefined : photo?.src} />
      <button type="button" className="pick" disabled={cropping} onClick={onClear}>
        <span className="ptext">{copy.photo.clear}</span>
        <Icon name="cross" size={18} className="pchev" />
      </button>
      {chooser}
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
