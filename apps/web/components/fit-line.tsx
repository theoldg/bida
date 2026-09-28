"use client";

import { useLayoutEffect, useRef, useState, type DependencyList, type ReactNode, type RefObject } from "react";
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
 * it leaves. `trail` is the same at the other end — a chevron that follows the
 * words rather than the box's edge — and `icon` goes before everything.
 *
 * `bodyClassName` wraps what is shown in an inline span, so a press can wash
 * the words and not the whole line: the box itself must stay as wide as the
 * room, or it would measure the rung it last chose.
 *
 * Renders `options[0]` on the server and first paint, then narrows in a layout
 * effect, before paint. Keep the ellipsis class anyway: the shortest rung
 * still holds a name of any length.
 */
export function FitLine({ options, className, lead, leadClassName, icon, trail, bodyClassName }: {
  options: readonly string[];
  className?: string;
  lead?: string;
  leadClassName?: string;
  icon?: ReactNode;
  trail?: ReactNode;
  bodyClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const trailRef = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState(0);
  // The array is rebuilt every render; its contents are what changes rarely.
  const key = `${lead ?? ""}\n${options.join("\n")}`;

  useRefit(ref, (el) => {
    const style = styleOf(el);
    // The content box: a line may pad itself to give a press wash room.
    const pad = getComputedStyle(el);
    const box = el.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const taken = (leadRef.current && lead
      ? textWidth(lead, styleOf(leadRef.current)) + textWidth(SEP, style)
      : 0) + outerWidth(iconRef.current) + outerWidth(trailRef.current);
    // Unmeasured stays 0 ("show everything"); a lead that fills the box
    // leaves 1px, so the leanest rung, not the richest.
    const room = box <= 0 ? 0 : Math.max(1, box - taken);
    setAt(fitIndex(options.map((o) => textWidth(o, style)), room));
  }, [key]); // `key` is `options`

  const shown = <>
    {icon ? <span ref={iconRef} className="fiticon">{icon}</span> : null}
    {lead ? <><b ref={leadRef} className={leadClassName}>{lead}</b>{SEP}</> : null}
    {options[Math.min(at, options.length - 1)] ?? ""}
    {trail ? <span ref={trailRef} className="fittrail">{trail}</span> : null}
  </>;
  return (
    <div ref={ref} className={className}>
      {bodyClassName ? <span className={bodyClassName}>{shown}</span> : shown}
    </div>
  );
}

/**
 * Measure before paint, and again whenever the box changes size or the web
 * font lands — it arrives after first paint and every width under it moves.
 * `deps` are what `measure` reads besides the element. Every fit in the app
 * runs on this: the two here and `/g/entry`'s balance sum.
 */
export function useRefit<T extends HTMLElement>(
  ref: RefObject<T | null>, measure: (el: T) => void, deps: DependencyList,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const run = () => { if (live) measure(el); };
    run();
    const watch = new ResizeObserver(run);
    watch.observe(el);
    // `fonts` is absent in older Safari; there the first measurement stands.
    void document.fonts?.ready.then(run).catch(() => {});
    return () => { live = false; watch.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what `measure` reads
  }, deps);
}

/** Width with margins: an icon's gap to the words is its margin. */
function outerWidth(el: HTMLElement | null): number {
  if (!el) return 0;
  const style = getComputedStyle(el);
  return el.offsetWidth + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
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

  useRefit(ref, (el) => {
    const at = parseFloat(getComputedStyle(el).fontSize);
    const available = el.clientWidth;
    const width = textWidth(text, styleOf(el));
    // No canvas (a test runner) or no box yet: the last rung is the one that
    // is right whatever the words are, so stay on it rather than guess big.
    if (!width || !at || available <= 0) return setSize(smallest);
    setSize(sizes.find((s) => (width * s) / at <= available) ?? smallest);
  }, [text, smallest]); // `sizes` is a literal

  return <h2 ref={ref} className={className} style={{ fontSize: size }}>{text}</h2>;
}
