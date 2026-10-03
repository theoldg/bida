/**
 * Reading the visual viewport: what the keyboard covers, and what nothing can
 * account for.
 *
 * The shell is `100dvh` and never scrolls (globals.css). The visual viewport
 * disagrees with it for two reasons:
 *
 * - **A keyboard.** On iOS it and its accessory bar overlay the layout viewport
 *   rather than shortening it, so the foot of `.scroll` sits behind them. Owed
 *   as `--kb`.
 * - **A browser that is wrong.** The same gap with nothing focused is a layout
 *   viewport taller than the screen: the shell's last strip (the about
 *   line) is off the bottom, unreachable.
 *
 * **A gap is a keyboard only while something is being typed into**, or it
 * becomes permanent padding.
 *
 * **Android pays nothing: it shrinks the page instead.** `interactive-widget=
 * resizes-content` (app/layout.tsx) has Chromium and Firefox take the keys
 * off the layout viewport, so `100dvh` ends at their top and there is no gap
 * to measure. Measuring was wrong a different way in every Android browser —
 * Chrome's tab, Brave and the installed app each moved the visual viewport
 * their own way, and `navigator.virtualKeyboard` reported keys mid-screen
 * while they slid. What the shrink can't say by itself is that the keys are
 * up, which `HoldCaret` needs: that is the layout viewport shorter than it has
 * been at this width by more than a toolbar.
 */

/** One look at the two viewports, and who has the caret. */
interface ViewportReading {
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
  /** The tallest the layout viewport has been at this width, keys down. */
  tallest: number;
}

/** What the difference between the two viewports means. */
interface ViewportGap {
  /** What the keyboard covers, in pixels. Zero unless something is focused. */
  kb: number;
  /** The same gap with nothing focused, which no keyboard explains. */
  unexplained: number;
  /** Whether keys are up — paid as `kb`, or taken off the page by Android. */
  up: boolean;
}

/**
 * A pixel or two is the mobile toolbar settling, not a keyboard, and paying it
 * as padding would twitch the end of every list.
 */
const NOISE = 4;

/**
 * A layout viewport shorter than its tallest by more than this has a keyboard
 * taken off it. Chrome's URL bar showing again is ~56px; no keyboard is short
 * of 150.
 */
const SHRUNK_BY_KEYS = 120;

export function gapOf(v: ViewportReading): ViewportGap {
  const none = { kb: 0, unexplained: 0, up: false };
  // A magnified page has a smaller visible viewport by definition, and the
  // difference is the magnification, not something sitting on the screen.
  if (Math.abs(v.scale - 1) > 0.01) return none;
  const gap = Math.round(v.inner - v.visible - v.offset);
  if (!v.typing) return gap > NOISE ? { ...none, unexplained: gap } : none;
  const kb = gap > NOISE ? gap : 0;
  return { kb, unexplained: 0, up: kb > 0 || v.tallest - v.inner > SHRUNK_BY_KEYS };
}

/**
 * What a press on a control beside a field does about the caret (`HoldCaret`,
 * components/viewport.tsx):
 *
 * - **hold** — a keyboard is up, so don't blur: the keyboard would retract,
 *   the page reflow, and the `click` miss the button.
 * - **blur** — no keyboard, but a field has the caret: Android's back button
 *   closes the keyboard without taking focus, and a press holding that focus
 *   reopens it. So the field is blurred by hand — whether `mousedown` moves
 *   focus varies by browser and target.
 * - **free** — nothing has the caret.
 */
type CaretAction = "hold" | "blur" | "free";

export function caretOnPress(keyboardUp: boolean, typing: boolean): CaretAction {
  if (!typing) return "free";
  return keyboardUp ? "hold" : "blur";
}

/**
 * Whether a keyboard opens for this element. Buttons and checkboxes are inputs
 * too, so types are named rather than the tag alone.
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

/**
 * **What the confirm key does to the field it was pressed in**: hand the caret
 * to the next field, or fold the keyboard.
 *
 * The key wears whatever `enterKeyHint` says, and that word is a promise: a
 * field drawn with "next" must move the caret on. Every other field ends its
 * chain and folds the keyboard, so a column of figures doesn't spill into the
 * next field drawn.
 *
 * A chord, and the Enter that picks an IME candidate, mean something else.
 */
export type ConfirmAct = "next" | "fold" | "none";

export function confirmAct(e: {
  key: string;
  /** The field's `enterKeyHint`; "" where it was drawn without one. */
  hint: string;
  isComposing: boolean;
  altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
}): ConfirmAct {
  if (e.key !== "Enter" || e.isComposing) return "none";
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return "none";
  return e.hint === "next" ? "next" : "fold";
}

/**
 * Types whose keyboard has no confirm key to press: a date is a spinner, and
 * the browser owns every key in it.
 */
const NO_CONFIRM = new Set(["date", "datetime-local", "month", "time", "week"]);

/** One look at a field the confirm key is considering landing the caret in. */
interface FieldReading {
  /** `isTyping` — a keyboard opens for it at all. */
  typing: boolean;
  /** An input's `type`; "textarea" for the other kind. */
  type: string;
  disabled: boolean;
  readOnly: boolean;
  /** It has a box on screen: a tab not showing renders no fields to walk into. */
  drawn: boolean;
}

/** Whether the caret can be put here. */
export function landsOn(f: FieldReading): boolean {
  return f.typing && f.drawn && !f.disabled && !f.readOnly && !NO_CONFIRM.has(f.type);
}
