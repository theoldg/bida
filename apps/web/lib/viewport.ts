// Doc: docs/touch-and-viewport.md
/**
 * Reading the visual viewport: what an iOS keyboard covers, and what nothing
 * can account for. Android shrinks the page instead and is never measured.
 */

interface ViewportReading {
  /** The height `100dvh` is laid out against. */
  inner: number;
  visible: number;
  offset: number;
  /** 1 unless the page is pinch-zoomed. */
  scale: number;
  typing: boolean;
  /** The tallest the layout viewport has been at this width, keys down. */
  tallest: number;
}

interface ViewportGap {
  /** What the keyboard covers. Zero unless something is focused. */
  kb: number;
  /** The same gap with nothing focused, which no keyboard explains. */
  unexplained: number;
  /** Keys up — paid as `kb`, or taken off the page by Android. */
  up: boolean;
}

/** The mobile toolbar settling, not a keyboard. */
const NOISE = 4;

/** Chrome's URL bar returning is ~56px; no keyboard is short of 150. */
const SHRUNK_BY_KEYS = 120;

export function gapOf(v: ViewportReading): ViewportGap {
  const none = { kb: 0, unexplained: 0, up: false };
  // A magnified page's smaller visible viewport is the magnification, not a
  // keyboard.
  if (Math.abs(v.scale - 1) > 0.01) return none;
  const gap = Math.round(v.inner - v.visible - v.offset);
  if (!v.typing) return gap > NOISE ? { ...none, unexplained: gap } : none;
  const kb = gap > NOISE ? gap : 0;
  return { kb, unexplained: 0, up: kb > 0 || v.tallest - v.inner > SHRUNK_BY_KEYS };
}

/**
 * What a press beside a field does about the caret (`HoldCaret`): **hold** it
 * while keys are up, or the reflow makes the click miss; **blur** it with none,
 * since Android's back hides the keys without taking focus.
 */
type CaretAction = "hold" | "blur" | "free";

export function caretOnPress(keyboardUp: boolean, typing: boolean): CaretAction {
  if (!typing) return "free";
  return keyboardUp ? "hold" : "blur";
}

/** Buttons and checkboxes are inputs too, so types are named. */
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
 * What the confirm key does: "next" in `enterKeyHint` is a promise to move the
 * caret on; every other field folds the keyboard. A chord, or Enter picking an
 * IME candidate, is something else.
 */
export type ConfirmAct = "next" | "fold" | "none";

export function confirmAct(e: {
  key: string;
  hint: string;
  isComposing: boolean;
  altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
}): ConfirmAct {
  if (e.key !== "Enter" || e.isComposing) return "none";
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return "none";
  return e.hint === "next" ? "next" : "fold";
}

/** A date is a spinner; the browser owns every key in it. */
const NO_CONFIRM = new Set(["date", "datetime-local", "month", "time", "week"]);

interface FieldReading {
  typing: boolean;
  type: string;
  disabled: boolean;
  readOnly: boolean;
  /** It has a box on screen: a tab not showing renders no fields to walk into. */
  drawn: boolean;
}

export function landsOn(f: FieldReading): boolean {
  return f.typing && f.drawn && !f.disabled && !f.readOnly && !NO_CONFIRM.has(f.type);
}
