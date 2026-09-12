"use client";

import { exponentOf, minorToDecimalString, parseMinor, type CurrencyCode } from "@bida/core";
import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { GROUP, groupDigits } from "../lib/format";

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
 *
 * The typing half of that — group, then put the caret back where the finger
 * thinks it is — is `GroupedInput`, and the rate dialog types into one too: a
 * rate is the other number in this app with thousands in it ("1 EUR = 18 000
 * IDR"), and it was the only field left that didn't group them.
 */

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

/**
 * The typed amount and the currency it is held in must never disagree: JPY has
 * no minor units and BHD has three, and `sanitizeAmount` otherwise only runs on
 * a keystroke. Switching currency with "12.34" in the field used to leave it
 * reading "12.34" while the model saved ¥12 — no keystroke in between, and
 * nothing on screen saying so. Every write to the entry draft goes through
 * this, and so does every scan: a receipt names its own currency.
 */
export function clipAmountToCurrency<T extends { amountText: string; currency: string }>(
  draft: T,
): T {
  const amountText = sanitizeAmount(draft.amountText, draft.currency);
  return amountText === draft.amountText ? draft : { ...draft, amountText };
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

export interface GroupedInputProps extends BaseProps {
  /** Canonical text: digits and at most one ".". Never grouped. */
  value: string;
  onChange: (canonical: string) => void;
  /** What may be typed. Must be idempotent, and must strip the group mark. */
  sanitize: (raw: string) => string;
  /** Underline the field so it reads as something you can type in. */
  frame?: "underline" | "none";
  /** Grow the field to hug its own figure (the big one on the expense form). */
  autoSize?: boolean;
  /** Class for the wrapper, not the input. */
  fieldClassName?: string;
}

/**
 * A number field that shows its thousands grouped while holding the ungrouped
 * text you typed. Everything here is about the caret; what a *given* field
 * will accept is its `sanitize`.
 */
export function GroupedInput({
  value, onChange, sanitize, frame = "underline", autoSize = false,
  fieldClassName, className, ...rest
}: GroupedInputProps) {
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
    const canonical = sanitize(raw);
    const before = Math.min(
      significantLength(sanitize(raw.slice(0, at))),
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
    />
  );

  const classes = [
    "amountfield",
    ...(frame === "none" ? ["plain"] : []),
    ...(autoSize ? ["autosize"] : []),
    ...(fieldClassName ? [fieldClassName] : []),
  ];

  return (
    <span className={classes.join(" ")}>
      {/* The mirror that gives an auto-sized field its width. Same class, so
          same font, weight and letter-spacing, so its box is the figure's own
          box to the pixel. `aria-hidden` because it is the same text twice. */}
      {autoSize ? (
        <span className={`${className ?? ""} amountsizer`} aria-hidden="true">
          {shown || rest.placeholder || "0"}
        </span>
      ) : null}
      {input}
    </span>
  );
}

/**
 * What a half-typed amount settles to once the field is left: "5" -> "5.00",
 * "1." -> "1.00", "1.5" -> "1.50". The text you type is deliberately left
 * alone while you type it (see above), which means a finished field could sit
 * there reading "5" next to a column of "12.00"s — the same number written two
 * ways, and the only one on screen that looks unfinished. Empty stays empty,
 * so a placeholder survives a tap that changed nothing, and a currency with no
 * minor units has nothing to pad.
 */
export function settleAmount(text: string, currency: CurrencyCode): string {
  if (text === "") return "";
  try { return minorToDecimalString(parseMinor(text, currency), currency); } catch { return text; }
}

export interface AmountInputProps extends Omit<GroupedInputProps, "sanitize"> {
  currency: CurrencyCode;
}

/** A `GroupedInput` that accepts what this currency can hold. */
export function AmountInput({ currency, value, onChange, onBlur, ...rest }: AmountInputProps) {
  return (
    <GroupedInput
      {...rest}
      value={value}
      onChange={onChange}
      sanitize={(raw) => sanitizeAmount(raw, currency)}
      onBlur={(e) => {
        const settled = settleAmount(value, currency);
        if (settled !== value) onChange(settled);
        onBlur?.(e);
      }}
    />
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
