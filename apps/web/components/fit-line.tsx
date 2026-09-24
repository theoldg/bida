"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fitIndex, styleOf, textWidth } from "../lib/fit";
import { copy } from "../lib/copy";

/** Between `lead` and the rung — the separator `copy.group.metaLine` puts between facts. */
const SEP = copy.group.metaLine("", "");

/**
 * One line that would rather say less than be cut off: given wordings longest
 * first, it renders the longest that fits. Why: [`lib/fit.ts`](../lib/fit.ts);
 * which wordings: [`lib/row-meta.ts`](../lib/row-meta.ts).
 *
 * `lead` is never dropped: it goes first, in bold, and the rungs fit in what
 * it leaves.
 *
 * Renders `options[0]` on the server and first paint, then narrows in a layout
 * effect, before paint. Keep the ellipsis class anyway: the shortest rung
 * still holds a name of any length.
 */
export function FitLine({ options, className, lead, leadClassName }: {
  options: readonly string[];
  className?: string;
  lead?: string;
  leadClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLElement>(null);
  const [at, setAt] = useState(0);
  // The array is rebuilt every render; its contents are what changes rarely.
  const key = `${lead ?? ""}\n${options.join("\n")}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const pick = () => {
      if (!live) return;
      const style = styleOf(el);
      const box = el.clientWidth;
      const taken = leadRef.current && lead
        ? textWidth(lead, styleOf(leadRef.current)) + textWidth(SEP, style)
        : 0;
      // Unmeasured stays 0 ("show everything"); a lead that fills the box
      // leaves 1px, so the leanest rung, not the richest.
      const room = box <= 0 ? 0 : Math.max(1, box - taken);
      setAt(fitIndex(options.map((o) => textWidth(o, style)), room));
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
      {lead ? <><b ref={leadRef} className={leadClassName}>{lead}</b>{SEP}</> : null}
      {options[Math.min(at, options.length - 1)] ?? ""}
    </div>
  );
}

/**
 * A title at the largest size that fits on one line: given a ladder of sizes,
 * largest first, it renders the largest that fits, else the last rung (the
 * size a title wraps at).
 *
 * Measured once and scaled: width is linear in font size, and `.entrytitle`'s
 * tracking is in `em`. The element is a block, so no feedback loop.
 *
 * Renders the **last** rung on the server and first paint, then grows. The
 * reverse would be visible: the static export paints before hydration, so a
 * long title would land as a wrapped heading and then shrink.
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
