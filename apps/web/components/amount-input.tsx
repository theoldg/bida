"use client";

import { exponentOf, minorToDecimalString, parseMinor, type CurrencyCode } from "@hajsik/core";
import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * Every field in the app where you type money.
 *
 * Three of them used to be written by hand, and two of those were controlled
 * from the *parsed* value: `value={bare(spec[id] ?? 0, currency)}`, re-derived
 * on every keystroke. Typing "1" showed "1.00" with the caret thrown to the
 * end; typing the "." of "1.50" threw, was swallowed by a `catch`, and simply
 * never appeared. You could not type a decimal amount at all. The owner, on
 * 2026-08-28: *"the amounts number input is really awkward to use, there's no
 * caret and i have no idea what's going on"*.
 *
 * So: one component, and it holds the *text* you typed, not a round-trip of
 * it. The model gets minor units; the field keeps your half-finished "1." and
 * your caret exactly where you left it.
 *
 * It also groups thousands as you type, because "480000" and "48000" are the
 * same glance. The group mark is a narrow no-break space rather than a comma
 * or a point: both of those are decimal separators to somebody, and this app
 * accepts either as one (see the open question in product.md). A space is
 * nobody's decimal separator, so nothing is ambiguous — and stripping it back
 * out on parse cannot eat a character the user meant.
 */

const GROUP = "\u202f";

/** "4800.5" -> "4\u202f800.5". Display only; never stored, never parsed. */
export function groupDigits(canonical: string): string {
  const [whole = "", frac] = canonical.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/**
 * Whatever a keyboard can produce -> the canonical text we store: digits, at
 * most one ".", the fraction clipped to the currency's exponent. "," is
 * accepted as a separator and normalised, because half of Europe types it.
 */
export function sanitizeAmount(raw: string, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  let text = raw.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  const first = text.indexOf(".");
  if (first !== -1) {
    text = text.slice(0, first + 1) + text.slice(first + 1).replace(/\./g, "");
  }
  if (exp === 0) text = text.split(".")[0] ?? "";
  const [whole = "", frac] = text.split(".");
  // "007" is a typo, not an amount: strip leading zeros but keep a lone "0".
  // A separator typed with nothing before it means "nought point something".
  const clipped = whole === "" && frac !== undefined
    ? "0"
    : whole.replace(/^0+(?=\d)/, "").slice(0, 12);
  return frac === undefined ? clipped : `${clipped}.${frac.slice(0, exp)}`;
}

/** Digits and the separator are what the caret counts; group marks are not. */
function significantLength(text: string): number {
  return text.replace(/[^0-9.]/g, "").length;
}

function caretAfter(display: string, significant: number): number {
  if (significant <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (/[0-9.]/.test(display[i]!)) {
      seen += 1;
      if (seen === significant) return i + 1;
    }
  }
  return display.length;
}

type BaseProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
>;

export interface AmountInputProps extends BaseProps {
  /** Canonical text: digits and at most one ".". Never grouped. */
  value: string;
  onChange: (canonical: string) => void;
  currency: CurrencyCode;
  /** Underline the field so it reads as something you can type in. */
  frame?: "underline" | "none";
  /** Grow the field to hug its own figure (the big one on the expense form). */
  autoSize?: boolean;
  /** Class for the wrapper, not the input. */
  fieldClassName?: string;
}

export function AmountInput({
  value, onChange, currency, frame = "underline", autoSize = false,
  fieldClassName, className, ...rest
}: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = groupDigits(value);

  // React writes the reformatted value into the DOM; we put the caret back
  // where the typist's finger thinks it is, in the same frame, so it never
  // visibly jumps to the end.
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return;
    const at = caret.current;
    caret.current = null;
    ref.current.setSelectionRange(at, at);
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const at = e.target.selectionStart ?? raw.length;
    const canonical = sanitizeAmount(raw, currency);
    const before = Math.min(
      significantLength(sanitizeAmount(raw.slice(0, at), currency)),
      significantLength(canonical),
    );
    caret.current = caretAfter(groupDigits(canonical), before);
    onChange(canonical);
  }

  /**
   * Backspace onto a group mark should eat the digit in front of it, not the
   * space — the space isn't something the user typed, so deleting it would
   * look like the key did nothing.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const at = el.selectionStart ?? 0;
    if (e.key === "Backspace" && at === el.selectionEnd && at > 0 && el.value[at - 1] === GROUP) {
      el.setSelectionRange(at - 1, at - 1);
    }
    rest.onKeyDown?.(e);
  }

  const input = (
    <input
      {...rest}
      ref={ref}
      className={className}
      inputMode="decimal"
      value={shown}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      size={autoSize ? Math.max(3, shown.length) : rest.size}
    />
  );

  return (
    <span className={`amountfield${frame === "none" ? " plain" : ""}${fieldClassName ? ` ${fieldClassName}` : ""}`}>
      {input}
    </span>
  );
}

function textFor(minor: number, currency: CurrencyCode): string {
  return minor === 0 ? "" : minorToDecimalString(minor, currency);
}

function minorOf(text: string, currency: CurrencyCode): number {
  if (!text) return 0;
  try { return parseMinor(text, currency); } catch { return 0; }
}

export interface MinorAmountInputProps extends Omit<AmountInputProps, "value" | "onChange"> {
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
}

/**
 * The same field for the editors that think in minor units (split amounts,
 * payer contributions). The text is local; the model only ever sees the
 * parsed number. It re-reads the model when something *else* changes it — the
 * "rest" button, a mode switch — and stays out of the way while you type.
 */
export function MinorAmountInput({
  valueMinor, onChangeMinor, currency, ...rest
}: MinorAmountInputProps) {
  const [text, setText] = useState(() => textFor(valueMinor, currency));
  const emitted = useRef(valueMinor);

  useEffect(() => {
    if (valueMinor === emitted.current) return;
    emitted.current = valueMinor;
    setText(textFor(valueMinor, currency));
  }, [valueMinor, currency]);

  return (
    <AmountInput
      {...rest}
      currency={currency}
      value={text}
      onChange={(next) => {
        setText(next);
        const minor = minorOf(next, currency);
        emitted.current = minor;
        onChangeMinor(minor);
      }}
    />
  );
}
