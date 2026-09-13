/**
 * Reading the visual viewport: what the keyboard covers, and what nothing can
 * account for.
 *
 * The shell is `100dvh` and never scrolls (globals.css). The visual viewport is
 * what is *actually* on screen, and the two disagree for two very different
 * reasons:
 *
 * - **A keyboard.** On iOS it and its accessory bar are drawn over the layout
 *   viewport rather than shortening it, so `dvh` doesn't move and the foot of
 *   `.scroll` ends up behind them. That difference is owed as `--kb`.
 * - **A browser that is wrong.** The same difference with nothing focused is
 *   not a keyboard: it is a layout viewport taller than the screen it is being
 *   painted on, which is a shell whose last strip — the bottom nav, the about
 *   line — is off the bottom with no way to scroll to it.
 *
 * Paying the second one as `--kb` is how a bogus measurement at load became
 * permanent padding nobody asked for, so the two are told apart here rather
 * than in the component: a gap is a keyboard only while something is being
 * typed into.
 */

/** One look at the two viewports, and who has the caret. */
export interface ViewportReading {
  /** The layout viewport — the height `100dvh` is laid out against. */
  inner: number;
  /** The visible viewport: what is on screen right now. */
  visible: number;
  /** How far the visible viewport has been panned down the layout one. */
  offset: number;
  /** 1 unless the page is pinch-zoomed. */
  scale: number;
  /** Whether something that opens a keyboard has the caret. */
  typing: boolean;
}

/** What the difference between the two viewports means. */
export interface ViewportGap {
  /** What the keyboard covers, in pixels. Zero unless something is focused. */
  kb: number;
  /** The same gap with nothing focused, which no keyboard explains. */
  unexplained: number;
}

/**
 * A pixel or two is the mobile toolbar settling, not a keyboard, and paying it
 * as padding would twitch the end of every list.
 */
const NOISE = 4;

export function gapOf(v: ViewportReading): ViewportGap {
  const none = { kb: 0, unexplained: 0 };
  // A magnified page has a smaller visible viewport by definition, and the
  // difference is the magnification, not something sitting on the screen.
  if (Math.abs(v.scale - 1) > 0.01) return none;
  const covered = Math.round(v.inner - v.visible - v.offset);
  if (covered <= NOISE) return none;
  return v.typing ? { kb: covered, unexplained: 0 } : { kb: 0, unexplained: covered };
}

/**
 * Whether this element is one a keyboard opens for. Buttons and checkboxes are
 * inputs too and open nothing, which is why the types are named rather than the
 * tag alone.
 */
const NO_KEYBOARD = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);

export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}
