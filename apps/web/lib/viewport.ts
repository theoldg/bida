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

/** One look at the screen against the layout viewport, in CSS pixels. */
export interface ScreenReading {
  /** `navigator.standalone`: true only in an iOS home-screen app. */
  standalone: boolean;
  /** `screen.width` and `screen.height`, which iOS reports in portrait whatever
      way the phone is held. */
  screen: { width: number; height: number };
  /** `innerWidth` and `innerHeight`. */
  inner: { width: number; height: number };
}

/**
 * How far an iOS home-screen app's web view stops short of the bottom of the
 * screen.
 *
 * With `black-translucent`, iOS 26 draws the page from the very top of the
 * screen but still takes the status bar off its height (WebKit bug 301108),
 * so the view ends a status bar short of the bottom edge. Nothing on the page
 * can paint that strip — no height, position or `vh` unit reaches it — but it
 * is also where the home indicator sits, so `env(safe-area-inset-bottom)`,
 * which still reads 34, pads the bottom bar clear of an indicator that is no
 * longer over the page: the two stack into a band twice as tall as it should
 * be. Only a home-screen app has no browser chrome to explain a view shorter
 * than the screen, which is why nothing else is asked.
 */
export function shortfallOf(r: ScreenReading): number {
  if (!r.standalone) return 0;
  const landscape = r.inner.width > r.inner.height;
  const tall = landscape
    ? Math.min(r.screen.width, r.screen.height)
    : Math.max(r.screen.width, r.screen.height);
  const short = Math.round(tall - r.inner.height);
  return short > NOISE ? short : 0;
}
