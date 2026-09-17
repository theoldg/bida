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
 * What a press on a control beside a field has to do about the caret
 * (`keepsFocus`, components/bits.tsx). Three cases, and the middle one is the
 * whole reason this is a function rather than a boolean:
 *
 * - **hold** — a keyboard is up, so the press must not blur the field: the
 *   blur retracts it, the page reflows, and the `click` misses the button.
 * - **blur** — no keyboard, but a field still has the caret. That is what the
 *   OS back button leaves behind on Android: it closes the keyboard without
 *   taking the focus, and a press that holds that focus tells the browser
 *   someone tapped with a text field focused, which opens the keyboard again.
 *   So the field is put down, by hand rather than by trusting the press to do
 *   it — whether a `mousedown` moves focus at all depends on the browser and
 *   on whether what was pressed can take it.
 * - **free** — nothing has the caret, so there is nothing to protect or undo.
 */
export type CaretAction = "hold" | "blur" | "free";

export function caretOnPress(keyboardUp: boolean, typing: boolean): CaretAction {
  if (!typing) return "free";
  return keyboardUp ? "hold" : "blur";
}

/** One look at a field being scrolled to, and the line it has to clear. */
export interface ReachReading {
  /** The field's bottom edge. */
  bottom: number;
  /** What has to stay visible *under* it — its `scroll-margin-bottom`, which is
      how a field says the act its screen ends on travels with it
      (`--act-below`, globals.css). Zero for an ordinary field. */
  room: number;
  /** Where a scroll has to stop: the scroller's bottom edge less the strip the
      keyboard covers (`scroll-padding-bottom`). */
  stop: number;
}

/**
 * How much further a scroller must go for a field *and the room it asks for*
 * to be clear of the keys.
 *
 * The browser will not always spend that room itself: `scrollIntoView`'s
 * `nearest` reads "already in view" off the field's own box, so a field the
 * browser has just parked above the keyboard is done as far as it is concerned
 * and whatever sits under it stays behind the keys.
 *
 * Never negative, because this only ever scrolls **up**: a field already high
 * enough is left alone, and a keyboard closing must not drag the list down to
 * re-hang it at the bottom of the screen.
 */
export function reachOf(r: ReachReading): number {
  return Math.max(0, Math.round(r.bottom + r.room - r.stop));
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
