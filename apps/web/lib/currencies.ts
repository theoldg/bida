/**
 * A short list, not a complete one. core/money.ts knows the ISO exponent of
 * every currency it is handed; this is only about what the picker offers first,
 * and anything missing can still be typed in.
 */
export const COMMON_CURRENCIES = [
  "EUR", "GBP", "USD", "PLN", "CHF", "CZK", "SEK", "NOK", "DKK",
  "MAD", "TRY", "JPY", "THB", "AUD", "CAD", "HUF", "RON", "ISK",
] as const;

export function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(undefined, { type: "currency" }).of(code);
    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}
