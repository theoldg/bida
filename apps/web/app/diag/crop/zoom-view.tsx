"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";

/**
 * An image over the whole screen, pinched, dragged and double-tapped by hand:
 * the app turns the browser's own zoom off (`NoPinchZoom`), and this screen is
 * where somebody needs to read a till roll's smallest line.
 */
export function ZoomView({ src, onClose }: { src: string; onClose: () => void }) {
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  /** A point on screen, measured from the view's centre, which is the transform's origin. */
  const local = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };

  /** Scale to `s`, keeping whatever is under `at` where it is. */
  const zoom = (v: typeof view, s: number, at: { x: number; y: number }) => {
    const next = Math.min(8, Math.max(1, s));
    if (next === 1) return { s: 1, x: 0, y: 0 };
    const k = next / v.s;
    return { s: next, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
  };

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), m: local((a!.x + b!.x) / 2, (a!.y + b!.y) / 2) };
  };

  return (
    <div className="zoomview" ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        const before = pointers.current.get(e.pointerId);
        if (!before) return;
        if (pointers.current.size === 2) {
          const was = spread();
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const now = spread();
          setView((v) => {
            const z = zoom(v, v.s * (now.d / was.d), was.m);
            return z.s === 1 ? z : { ...z, x: z.x + now.m.x - was.m.x, y: z.y + now.m.y - was.m.y };
          });
        } else {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          setView((v) => (v.s === 1 ? v
            : { ...v, x: v.x + e.clientX - before.x, y: v.y + e.clientY - before.y }));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size > 0) return;
        const now = e.timeStamp;
        if (now - lastTap.current < 300) {
          const at = local(e.clientX, e.clientY);
          setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : zoom(v, 3, at)));
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); }}
      onWheel={(e) => {
        const at = local(e.clientX, e.clientY);
        setView((v) => zoom(v, v.s * Math.exp(-e.deltaY / 300), at));
      }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data or object URL */}
      <img src={src} alt="" draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
      <button type="button" className="zoomview-close" aria-label={copy.diag.crop.close}
        onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>×</button>
    </div>
  );
}
