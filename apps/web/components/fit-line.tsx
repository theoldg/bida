"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fitIndex, styleOf, textWidth } from "../lib/fit";

/**
 * One line that would rather say less than be cut off.
 *
 * Give it the same line written several ways, longest first; it renders the
 * longest one that fits its own box. Why, and why measured on a canvas:
 * [`lib/fit.ts`](../lib/fit.ts). Which wordings, and in what order:
 * [`lib/row-meta.ts`](../lib/row-meta.ts).
 *
 * It renders `options[0]` on the server and on the first client paint, then
 * narrows in a layout effect — before paint, so nothing is ever seen being
 * shortened. Keep the ellipsis on the element's class anyway: the shortest
 * rung still has a name in it, and a name can be any length at all.
 */
export function FitLine({ options, className }: {
  options: readonly string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // The array is rebuilt every render; its contents are what changes rarely.
  const key = options.join(" ");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const pick = () => {
      if (!live) return;
      const style = styleOf(el);
      setAt(fitIndex(options.map((o) => textWidth(o, style)), el.clientWidth));
    };
    pick();
    const watch = new ResizeObserver(pick);
    watch.observe(el);
    // The web font arrives after first paint and every width under it moves.
    // `fonts` is absent in older Safari; there the first measurement stands.
    void document.fonts?.ready.then(pick).catch(() => {});
    return () => { live = false; watch.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `options`
  }, [key]);

  return (
    <div ref={ref} className={className}>
      {options[Math.min(at, options.length - 1)] ?? ""}
    </div>
  );
}
