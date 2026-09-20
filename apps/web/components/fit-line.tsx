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

/**
 * A title at the largest size that still says it in one line.
 *
 * "Dinner" and a sentence somebody typed into the same field want different
 * type: one is a heading, the other is a paragraph, and a size picked for
 * either is wrong for the other. So the screen hands over a ladder of sizes,
 * largest first, and this renders the largest that measures under the box —
 * or the last rung, which is the size a title wraps at.
 *
 * Measured once, at whatever size it is currently rendered, and scaled: width
 * is linear in the font size, and `.entrytitle`'s tracking is in `em`, so it
 * scales with it. No feedback loop to guard against, either — the element is a
 * block, so its width is the container's whatever the type does.
 *
 * It renders the **last** rung on the server and on the first client paint,
 * then grows in a layout effect. The other way round is the one a person can
 * see: the static export paints before hydration, so a long title would land
 * as a wrapped heading and then shrink.
 */
export function FitTitle({ text, sizes, className }: {
  text: string;
  /** Largest first. The last is the one a title that fits no rung wraps at. */
  sizes: readonly number[];
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const smallest = sizes[sizes.length - 1] ?? 17;
  const [size, setSize] = useState(smallest);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const pick = () => {
      if (!live) return;
      const at = parseFloat(getComputedStyle(el).fontSize);
      const available = el.clientWidth;
      const width = textWidth(text, styleOf(el));
      // No canvas (a test runner) or no box yet: the last rung is the one that
      // is right whatever the words are, so stay on it rather than guess big.
      if (!width || !at || available <= 0) return setSize(smallest);
      setSize(sizes.find((s) => (width * s) / at <= available) ?? smallest);
    };
    pick();
    const watch = new ResizeObserver(pick);
    watch.observe(el);
    // The web font arrives after first paint and every width under it moves.
    void document.fonts?.ready.then(pick).catch(() => {});
    return () => { live = false; watch.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sizes` is a literal
  }, [text, smallest]);

  return <h2 ref={ref} className={className} style={{ fontSize: size }}>{text}</h2>;
}
