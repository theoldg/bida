// Doc: docs/entry.md
/**
 * A short list, not a complete one. core/money.ts knows the ISO exponent of
 * every currency it is handed; this is only about what the picker offers first,
 * and anything missing is a search away (`currencySearch`).
 */
export const COMMON_CURRENCIES = [
  "EUR", "GBP", "USD", "PLN", "CHF", "CZK", "SEK", "NOK", "DKK",
  "MAD", "TRY", "JPY", "THB", "AUD", "CAD", "HUF", "RON", "ISK", "UZS",
] as const;

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

/** A search names every currency the browser knows, on every key. */
const labels = new Map<string, string>();

export function currencyLabel(code: string): string {
  const kept = labels.get(code);
  if (kept !== undefined) return kept;
  let name: string | undefined;
  try {
    const found = new Intl.DisplayNames(undefined, { type: "currency" }).of(code);
    if (found && found !== code) name = found;
  } catch {
    // Left to the fallback below, same as a locale that has no name for it.
  }
  name ??= FALLBACK_NAMES[code];
  const label = name ? `${code} · ${name}` : code;
  labels.set(code, label);
  return label;
}

/**
 * The order a currency picker offers, deduplicated: `pinned` (the base and
 * the current pick), then the group's own currencies, most spent-in first
 * (`currenciesInUse`), then the rest.
 */
export function currencyChoices(
  pinned: readonly string[], inUse: readonly string[] = [],
): string[] {
  return [...new Set([...pinned, ...inUse, ...COMMON_CURRENCIES])];
}

/** Every code the browser can name; the short list where it can't say. */
function knownCurrencies(): readonly string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return COMMON_CURRENCIES;
  }
}

/** Case and accents aside, so "krona" finds the Króna. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * What the picker's search offers for `query`: the code itself, then codes
 * starting with it, then names holding it — `choices` first within each, then
 * every other currency the browser knows. Empty, it is `choices` as they are.
 * `typed` is a three-letter query no code answers, to be used as written.
 */
export function currencySearch(
  query: string, choices: readonly string[], known: readonly string[] = knownCurrencies(),
): { codes: string[]; typed: string | null } {
  const q = fold(query.trim());
  if (!q) return { codes: [...choices], typed: null };
  const rank = (code: string): number => {
    const c = code.toLowerCase();
    if (c === q) return 0;
    if (c.startsWith(q)) return 1;
    return fold(currencyLabel(code)).includes(q) ? 2 : 3;
  };
  const codes = [...new Set([...choices, ...known])]
    .map((code) => ({ code, rank: rank(code) }))
    .filter((m) => m.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .map((m) => m.code);
  const code = normalizeCurrencyCode(query);
  const typed = code.length === 3 && code.toLowerCase() === q && !codes.includes(code) ? code : null;
  return { codes, typed };
}
