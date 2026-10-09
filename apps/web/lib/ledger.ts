import { minorToDecimalString, payerList, splitParticipants, type Expense, type Settlement } from "@bida/core";
import { kindOf, type EntryKind } from "./entry-kind";
import { byWhen } from "./format";
import type { LedgerItem } from "./ledger-motion";

/**
 * The ledger's two tables as one list, in the order a person reads them.
 *
 * Each table arrives sorted (`useGroupData`), but merged they need one
 * comparator over both — and merged is what the screen draws.
 */

/**
 * One row. `row` names the table, not the kind — an income is `row:
 * "expense"`; the kind is on the expense (`kindOf`).
 *
 * **A row carries the stored entry and nothing copied off it** — copied
 * fields miss the next one the order depends on (as `dateOnly` would),
 * silently mis-sorting the ledger.
 */
export type LedgerRow =
  | { row: "expense"; expense: Expense }
  | { row: "settlement"; settlement: Settlement };

/** The stored entry behind a row. */
export function entryOf(row: LedgerRow): Expense | Settlement {
  return row.row === "expense" ? row.expense : row.settlement;
}

export function ledgerRows(expenses: Expense[], settlements: Settlement[]): LedgerRow[] {
  return [
    ...expenses.map((expense): LedgerRow => ({ row: "expense", expense })),
    ...settlements.map((settlement): LedgerRow => ({ row: "settlement", settlement })),
  ].sort((a, b) => byWhen(entryOf(a), entryOf(b)));
}

/**
 * The ledger as it is drawn: its rows, each day's run headed by a date line.
 * A date line is its own item rather than riding on the day's first row, so
 * it stays put while a row above it in the same day comes or goes, and folds
 * on its own when the last one does. Keyed by the calendar day, not the
 * label, which renames itself at midnight ("Today" → "Yesterday").
 */
export function ledgerItems(
  expenses: Expense[], settlements: Settlement[], label: (ts: number) => string,
): LedgerItem<LedgerRow>[] {
  const out: LedgerItem<LedgerRow>[] = [];
  let last = "";
  for (const row of ledgerRows(expenses, settlements)) {
    const at = entryOf(row).occurredAt;
    const day = label(at);
    if (day !== last) {
      const d = new Date(at);
      out.push({ key: `day:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, kind: "day", label: day });
      last = day;
    }
    out.push({ key: entryOf(row).id, kind: "row", row });
  }
  return out;
}

/** How a word is compared: case and accents aside, so "cafe" finds "Café". */
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Whether a typed number is this figure (`minorToDecimalString`'s text:
 * "17000.00", "25000"). Whole, it is the start of the figure's whole part, so
 * "17" finds 17,000 on the way to typing it; with a decimal mark the whole part
 * is settled and the cents are what is still being typed. A comma or a dot may
 * be either mark: one followed by exactly three digits could be grouping, so
 * both readings are tried.
 */
export function figureMatches(typed: string, figure: string): boolean {
  if (!/^\d[\d.,]*$/.test(typed)) return false;
  const [whole = "", cents = ""] = figure.split(".");
  const parts = typed.split(/[.,]/);
  const tail = parts.at(-1) ?? "";
  const grouped = parts.slice(1).every((p) => p.length === 3);
  if (grouped && whole.startsWith(parts.join(""))) return true;
  return parts.length > 1 && whole === parts.slice(0, -1).join("") && cents.startsWith(tail);
}

/**
 * Where on a row a word can be found, best first: a word in the title says
 * more about what was meant than the same word in a figure.
 */
export const SEARCH_TIERS = ["title", "payer", "participant", "currency", "kind", "amount"] as const;
export type SearchTier = typeof SEARCH_TIERS[number];

/** What a search needs from the screen: its members' names, its words, its currency. */
export interface SearchContext {
  nameOf: (member: string) => string | undefined;
  /** The kind as the app writes it (`copy.entryKind.label`). */
  kindWord: (kind: EntryKind) => string;
  /** What heads each tier's rows (`copy.group.search.by`). */
  tierLabel: (tier: SearchTier) => string;
  base: string;
}

/** A row as a search reads it: each place a word can be found, made plain once. */
interface Searched {
  title: string; payer: string; participant: string;
  currency: string; kind: string;
  /** As entered and as converted (`figureMatches`). */
  figures: [string, string];
}

function searched(row: LedgerRow, { nameOf, kindWord, base }: SearchContext): Searched {
  const entry = entryOf(row);
  const names = (ids: string[]) => plain(ids.map(nameOf).filter(Boolean).join("\n"));
  return {
    // A transfer's title is what its row is headed with, "Luke → Han", so both
    // names are found there before they are found as its two sides; the arrow as
    // it is typed finds it too. Its note is the only thing anyone wrote on it.
    ...(row.row === "expense" ? {
      title: plain(row.expense.description ?? ""),
      payer: names(payerList(row.expense)),
      participant: names(splitParticipants(row.expense.split)),
    } : {
      title: plain([
        nameOf(row.settlement.fromMember), "→ ->", nameOf(row.settlement.toMember), row.settlement.note,
      ].filter(Boolean).join("\n")),
      payer: names([row.settlement.fromMember]),
      participant: names([row.settlement.toMember]),
    }),
    currency: plain(entry.currency),
    kind: plain(kindWord(row.row === "expense" ? kindOf(row.expense) : "transfer")),
    figures: [
      minorToDecimalString(entry.amountMinor, entry.currency),
      minorToDecimalString(entry.baseAmountMinor, base),
    ],
  };
}

/** Which tiers hold `word` on this row. */
function tiersOf(row: Searched, word: string): SearchTier[] {
  const by: Record<SearchTier, boolean> = {
    title: row.title.includes(word),
    payer: row.payer.includes(word),
    participant: row.participant.includes(word),
    currency: row.currency === word,
    kind: row.kind === word,
    amount: row.figures.some((figure) => figureMatches(word, figure)),
  };
  return SEARCH_TIERS.filter((t) => by[t]);
}

/**
 * The drawn ledger narrowed to what a search finds. **Every word typed must be
 * found in some field of the row**, each word in whichever it likes:
 *
 * - anywhere in its title, its payers' names or its participants' — a
 *   transfer's title is its two names and its note, and its sides are who
 *   gave and who got;
 * - as the whole of its currency ("eur", never "eu") or of its kind;
 * - as a number, in the figure it was entered in or the one it converts to
 *   (`figureMatches`).
 *
 * **Sectioned by the best place any word was found** (`SEARCH_TIERS`), each
 * section headed like a day. Within one, the rows with more of the words in
 * that place come first, and level there, the most recent. The date lines go:
 * a section is not a day.
 */
export function searchLedger(
  items: LedgerItem<LedgerRow>[], query: string, context: SearchContext,
): LedgerItem<LedgerRow>[] {
  const words = [...new Set(plain(query).split(/\s+/).filter(Boolean))];
  if (words.length === 0) return items;
  // `count`: how many of the words the row's best tier holds.
  const hits: { item: LedgerItem<LedgerRow>; tier: number; count: number }[] = [];
  for (const item of items) {
    if (item.kind !== "row") continue;
    const row = searched(item.row, context);
    const found = words.map((w) => tiersOf(row, w));
    if (found.some((tiers) => tiers.length === 0)) continue;
    const tier = Math.min(...found.flat().map((t) => SEARCH_TIERS.indexOf(t)));
    hits.push({ item, tier, count: found.filter((tiers) => tiers.includes(SEARCH_TIERS[tier]!)).length });
  }
  // Stable, so rows level on both stay in the ledger's order: most recent
  // first. Nothing a row doesn't show under its section decides its place.
  hits.sort((a, b) => a.tier - b.tier || b.count - a.count);
  const out: LedgerItem<LedgerRow>[] = [];
  let last = -1;
  for (const { item, tier } of hits) {
    if (tier !== last) {
      const name = SEARCH_TIERS[tier]!;
      out.push({ key: `tier:${name}`, kind: "day", label: context.tierLabel(name) });
      last = tier;
    }
    out.push(item);
  }
  return out;
}
