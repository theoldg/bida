/**
 * Say less rather than be cut off.
 *
 * A row's second line is a stack of facts — who paid, how many ways, in what
 * mode — and on a 360px phone with a long name in it the stack does not fit.
 * `text-overflow: ellipsis` is the browser's answer and it is the wrong one:
 * it cuts mid-word, always at the end, so the line loses whatever happened to
 * be last rather than whatever mattered least ("Alice + 1 other paid · 5 peo…").
 *
 * So the screen hands over *several* wordings of the same line, richest first,
 * and this picks the richest that fits. The ladder is the editorial decision
 * and lives with the copy (`lib/row-meta.ts`); everything here is measurement.
 *
 * Measured on a canvas rather than by rendering and reading `scrollWidth`:
 * one pass, no layout thrash, and no chance of a feedback loop where the text
 * that fits changes the box that decides whether it fits.
 */

/** First width that fits, else the leanest. Widths are richest-first. */
export function fitIndex(widths: readonly number[], available: number): number {
  if (widths.length === 0) return 0;
  // Not laid out yet (a detached node, a hidden tab): promise nothing, show
  // everything. A width of 0 would otherwise pick the shortest rung and stay
  // there, since nothing re-measures a box that never resized.
  if (available <= 0) return 0;
  for (let i = 0; i < widths.length; i++) {
    if ((widths[i] ?? Infinity) <= available) return i;
  }
  return widths.length - 1;
}

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  }
  return ctx;
}

/** How this element draws text, as the canvas `font` shorthand wants it. */
interface TextStyle {
  font: string;
  letterSpacing: string;
}

export function styleOf(el: Element): TextStyle {
  const s = getComputedStyle(el);
  // Every engine we ship to computes the `font` shorthand, but it returns ""
  // when the longhands can't be expressed as one (a `font-stretch`, say), and
  // an empty font silently measures at the canvas default of 10px sans-serif.
  const font = s.font || `${s.fontWeight} ${s.fontSize} / ${s.lineHeight} ${s.fontFamily}`;
  return { font, letterSpacing: s.letterSpacing === "normal" ? "0px" : s.letterSpacing };
}

/**
 * Width of `text` in `style`, in CSS pixels. 0 where there is no canvas — in
 * a test runner, or prerendering — which `fitIndex` reads as "it all fits",
 * so the static export ships the full line and the browser narrows it.
 */
export function textWidth(text: string, style: TextStyle): number {
  const c = context();
  if (!c) return 0;
  if (c.font !== style.font) c.font = style.font;
  // Chrome honours this and nothing else implements it yet; where it is
  // missing the assignment is inert rather than an error.
  if ("letterSpacing" in c && c.letterSpacing !== style.letterSpacing) {
    c.letterSpacing = style.letterSpacing;
  }
  return c.measureText(text).width;
}
