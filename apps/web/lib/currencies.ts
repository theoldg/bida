/**
 * A short list, not a complete one. core/money.ts knows the ISO exponent of
 * every currency it is handed; this is only about what the picker offers first,
 * and anything missing can still be typed in.
 */
export const COMMON_CURRENCIES = [
  "EUR", "GBP", "USD", "PLN", "CHF", "CZK", "SEK", "NOK", "DKK",
  "MAD", "TRY", "JPY", "THB", "AUD", "CAD", "HUF", "RON", "ISK", "UZS",
] as const;

/** Sentinel option value that opens a free-text field for any ISO 4217 code. */
export const OTHER_CURRENCY = "__other__";

/**
 * Names for the currencies `Intl.DisplayNames` can be short of. It reads the
 * browser's own locale data, and a trimmed build answers with the code itself
 * for the ones few locales spend in — a row reading "ISK" twice over. Only
 * what the list above offers needs covering; a typed-in code can stay a code.
 */
const FALLBACK_NAMES: Record<string, string> = {
  ISK: "Icelandic Króna",
  UZS: "Uzbekistani Som",
};

/** Normalize a typed currency code: uppercase, letters only, max 3. */
export function normalizeCurrencyCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

export function currencyLabel(code: string): string {
  let name: string | undefined;
  try {
    const found = new Intl.DisplayNames(undefined, { type: "currency" }).of(code);
    if (found && found !== code) name = found;
  } catch {
    // Left to the fallback below, same as a locale that has no name for it.
  }
  name ??= FALLBACK_NAMES[code];
  return name ? `${code} · ${name}` : code;
}

/**
 * The order a currency picker offers, deduplicated.
 *
 * The group's own currencies come right after the base one, most spent-in
 * first (`currenciesInUse` sorts them), because a trip spends in two or three
 * currencies and scrolling past the other seventeen to reach the one every
 * entry is in is the whole of the annoyance. `pinned` is what the screen puts
 * above them — the base currency, and whatever is currently picked.
 */
export function currencyChoices(
  pinned: readonly string[], inUse: readonly string[] = [],
): string[] {
  return [...new Set([...pinned, ...inUse, ...COMMON_CURRENCIES])];
}
