"use client";
// Doc: docs/frontend.md

import { exponentOf, minorToDecimalString, parseMinor, type CurrencyCode } from "@bida/core";
import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { GROUP, groupDigits } from "../lib/format";

/**
 * Holds the *text* typed, never a round-trip of the parsed value — that snaps "1"
 * to "1.00" and throws the caret. Groups with a narrow no-break space, since a
 * comma or point is somebody's decimal separator.
 */

/** "," is accepted as the separator, because half of Europe types it. */
export function sanitizeAmount(raw: string, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  let text = raw.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  const first = text.indexOf(".");
  if (first !== -1) {
    text = text.slice(0, first + 1) + text.slice(first + 1).replace(/\./g, "");
  }
  if (exp === 0) text = text.split(".")[0] ?? "";
  const [whole = "", frac] = text.split(".");
  const clipped = whole === "" && frac !== undefined
    ? "0"
    : whole.replace(/^0+(?=\d)/, "").slice(0, 12);
  return frac === undefined ? clipped : `${clipped}.${frac.slice(0, exp)}`;
}

/**
 * The typed amount and its currency must never disagree: switching JPY over
 * "12.34" would otherwise save ¥12 with nothing on screen saying so.
 */
export function clipAmountToCurrency<T extends { amountText: string; currency: string }>(
  draft: T,
): T {
  const amountText = sanitizeAmount(draft.amountText, draft.currency);
  return amountText === draft.amountText ? draft : { ...draft, amountText };
}

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

interface GroupedInputProps extends BaseProps {
  value: string;
  onChange: (canonical: string) => void;
  /** Must be idempotent, and must strip the group mark. */
  sanitize: (raw: string) => string;
  frame?: "underline" | "none";
  autoSize?: boolean;
  fieldClassName?: string;
  inputMode?: "decimal" | "numeric";
}

export function GroupedInput({
  value, onChange, sanitize, frame = "underline", autoSize = false,
  fieldClassName, className, inputMode = "decimal", ...rest
}: GroupedInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = groupDigits(value);

  // Put the caret back in the same frame React rewrote the value, so it never
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
   * Backspace onto a group mark eats the digit before it, since nobody typed the
   * space.
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
      inputMode={inputMode}
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
      {/* Same class as the input, so its box is the figure's own to the pixel. */}
      {autoSize ? (
        <span className={`${className ?? ""} amountsizer`} aria-hidden="true">
          {shown || rest.placeholder || "0"}
        </span>
      ) : null}
      {input}
    </span>
  );
}

export function settleAmount(text: string, currency: CurrencyCode): string {
  if (text === "") return "";
  try { return minorToDecimalString(parseMinor(text, currency), currency); } catch { return text; }
}

interface AmountInputProps extends Omit<GroupedInputProps, "sanitize"> {
  currency: CurrencyCode;
}

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

interface MinorAmountInputProps extends Omit<AmountInputProps, "value" | "onChange"> {
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
}

/** The text is local; it re-reads the model only when something else moves it. */
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

export const MAX_PARTS = 999;

export function sanitizeParts(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, String(MAX_PARTS).length);
}

interface PartsInputProps extends Omit<GroupedInputProps, "value" | "onChange" | "sanitize" | "inputMode"> {
  value: number;
  onChangeValue: (parts: number) => void;
}

export function PartsInput({ value, onChangeValue, onBlur, ...rest }: PartsInputProps) {
  const [text, setText] = useState(() => (value ? String(value) : ""));
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(value ? String(value) : "");
  }, [value]);

  return (
    <GroupedInput
      {...rest}
      inputMode="numeric"
      value={text}
      sanitize={sanitizeParts}
      onChange={(next) => {
        setText(next);
        const parts = Number(next || 0);
        emitted.current = parts;
        onChangeValue(parts);
      }}
      onBlur={(e) => {
        if (text === "0") setText("");
        onBlur?.(e);
      }}
    />
  );
}
