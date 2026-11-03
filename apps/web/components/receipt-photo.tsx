"use client";
// Doc: docs/photos.md

import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * shows the head of the bill, where the name is; the viewer opens it at the
 * screen's width, a till roll running down past the foot.
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

/** How far a press may wander and still be a tap, and how long a fling glides on. */
const TAP_SLOP = 8;
const GLIDE_MS = 325;

/**
 * A real `<dialog>`, like `Dialog`, so the device's back closes it — but no
 * card: the photo is the whole screen, on a dark ground in both themes, where
 * white paper has an edge.
 *
 * Pinched, dragged and flung by hand, since the app turns the browser's own
 * zoom off (`NoPinchZoom`) and the smallest line of a till roll is what
 * somebody opens it to read. Only the photo moves: the cross is fixed over it.
 * An edge stops at the stage's edge, so the head of the bill can always come
 * out from under the cross. A tap anywhere puts it away.
 */
export function PhotoViewer({ src, overlay, onClose }: {
  src: string;
  /** Drawn over the photo at its size, and moved with it: /diag/crop's marks. */
  overlay?: ReactNode;
  onClose: () => void;
}) {
  const frame = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const pic = useRef<HTMLImageElement>(null);
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

  useEffect(() => {
    const el = frame.current, box = stage.current, sheet = plate.current, img = pic.current;
    if (!el || !box || !sheet || !img) return;
    type View = { s: number; x: number; y: number };
    type At = { x: number; y: number };
    /** Scale over the screen's width, and the photo's top left on the stage. */
    let view: View = { s: 1, x: 0, y: 0 };
    let glide = 0;
    const fingers = new Map<number, At>();
    /** The press that may yet turn out a tap, and whether the last one did. */
    let press: (At & { t: number }) | null = null;
    let tapped = false;
    /** One finger's last moments, for the speed it lets go at. */
    let trail: (At & { t: number })[] = [];

    // Up to a pixel of the photo per pixel of screen, and never under 5×.
    const most = () => Math.max(5, img.naturalWidth / (img.offsetWidth || 1));
    const paint = (next: View) => {
      const room = box.getBoundingClientRect();
      const s = Math.min(most(), Math.max(1, next.s));
      const pin = (p: number, size: number, space: number) =>
        space >= size ? (space - size) / 2 : Math.min(0, Math.max(space - size, p));
      view = { s, x: pin(next.x, sheet.offsetWidth * s, room.width), y: pin(next.y, sheet.offsetHeight * s, room.height) };
      sheet.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
    };
    const onStage = (x: number, y: number): At => {
      const r = box.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    /** What was under `from` lands under `to`, `k` times as large. */
    const move = (k: number, from: At, to: At) => {
      const s = Math.min(most(), Math.max(1, view.s * k));
      const f = s / view.s;
      paint({ s, x: to.x - (from.x - view.x) * f, y: to.y - (from.y - view.y) * f });
    };
    const stop = () => cancelAnimationFrame(glide);
    const reset = () => { stop(); paint({ s: 1, x: 0, y: 0 }); };
    const pair = () => {
      const [a, b] = [...fingers.values()] as [At, At];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: onStage((a.x + b.x) / 2, (a.y + b.y) / 2) };
    };
    // The cross is a button of its own.
    const mine = (e: PointerEvent) => !(e.target as Element).closest("button");

    const down = (e: PointerEvent) => {
      tapped = false;
      if (!mine(e) || e.button !== 0) return;
      stop();
      el.setPointerCapture(e.pointerId);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      press = fingers.size === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
      trail = [];
    };
    const drag = (e: PointerEvent) => {
      const was = fingers.get(e.pointerId);
      if (!was) return;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) press = null;
      if (fingers.size >= 2) {
        const before = pair();
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const after = pair();
        move(after.d / before.d, before.m, after.m);
        return;
      }
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      paint({ ...view, x: view.x + e.clientX - was.x, y: view.y + e.clientY - was.y });
      trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (trail.length > 8) trail.shift();
    };
    const lift = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      const marks = trail;
      // The finger a pinch leaves behind carries on from where it is.
      trail = [];
      if (fingers.size > 0) return;
      tapped = !!press && e.timeStamp - press.t < 500;
      press = null;
      if (!tapped) fling(marks, e.timeStamp);
    };
    // On the click, not the lift: gone at the lift, the tap's click would land
    // on whatever was under the photo — its own miniature, opening it again.
    const click = () => { if (tapped) closed.current(); };
    const lost = (e: PointerEvent) => { press = null; trail = []; fingers.delete(e.pointerId); };
    const fling = (marks: (At & { t: number })[], t: number) => {
      const recent = marks.filter((p) => t - p.t < 100);
      const a = recent[0], b = recent[recent.length - 1];
      if (!a || !b || b.t - a.t < 10) return;
      let vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t);
      let then = performance.now();
      const step = (now: number) => {
        const dt = now - then;
        then = now;
        const was = view;
        paint({ ...view, x: view.x + vx * dt, y: view.y + vy * dt });
        const f = Math.exp(-dt / GLIDE_MS);
        vx *= f;
        vy *= f;
        if (Math.hypot(vx, vy) > 0.02 && (view.x !== was.x || view.y !== was.y)) glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };
    // A wheel scrolls the roll; a trackpad's pinch arrives as a wheel with Ctrl.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      stop();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
      if (e.ctrlKey) {
        const at = onStage(e.clientX, e.clientY);
        move(Math.exp((-e.deltaY * unit) / 200), at, at);
      } else {
        paint({ ...view, x: view.x - e.deltaX * unit, y: view.y - e.deltaY * unit });
      }
    };

    if (img.complete) reset();
    img.addEventListener("load", reset);
    window.addEventListener("resize", reset);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", drag);
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lost);
    el.addEventListener("click", click);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stop();
      img.removeEventListener("load", reset);
      window.removeEventListener("resize", reset);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", drag);
      el.removeEventListener("pointerup", lift);
      el.removeEventListener("pointercancel", lost);
      el.removeEventListener("click", click);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <dialog className="photoview" ref={frame} aria-label={copy.photo.title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="photoframe" ref={stage}>
        <div className="photoplate" ref={plate}>
          <img ref={pic} src={src} alt={copy.photo.title} draggable={false} />
          {overlay}
        </div>
      </div>
      <button type="button" className="photoclose" aria-label={copy.act.close} onClick={onClose}>
        <Icon name="cross" size={14} />
      </button>
    </dialog>
  );
}
