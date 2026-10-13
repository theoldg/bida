// Doc: docs/data-model.md#a-day-without-a-time
import {
  minorToDecimalString, payerList, splitParticipants, startOfLocalDay, type Expense, type Settlement,
} from "@bida/core";
import { kindOf, type EntryKind } from "./entry-kind";
import { withinDay } from "./format";
import type { LedgerItem } from "./ledger-motion";

/**
 * A row carries the stored entry and nothing copied off it — a copied field
 * misses the next one the order depends on, silently mis-sorting the ledger.
 */
export type LedgerRow =
  | { row: "expense"; expense: Expense }
  | { row: "settlement"; settlement: Settlement };

export function entryOf(row: LedgerRow): Expense | Settlement {
  return row.row === "expense" ? row.expense : row.settlement;
}

/**
 * Rows `byWhen` can't tell apart (an import's timeless day carries no
 * `createdAt`) fall back to the order the read hands them in — expenses first,
 * then by id — said outright, so a row the list holds on to after it went
 * (`peekDeleted`) comes back to its own place, not the foot of its day.
 */
export function ledgerRows(expenses: Expense[], settlements: Settlement[]): LedgerRow[] {
  return dayed(expenses, settlements).map((k) => k.row);
}

/**
 * In `ledgerRows`' order, each row's day worked out once rather than at every
 * comparison (`sortedByWhen`, lib/format.ts). Lists handed in already in order
 * cost one merge: the sort finds the two runs.
 */
function dayed(expenses: Expense[], settlements: Settlement[]): { row: LedgerRow; day: number }[] {
  const id = (row: LedgerRow) => entryOf(row).id;
  const keyed = [
    ...expenses.map((expense) => ({ row: { row: "expense", expense } as LedgerRow, day: startOfLocalDay(expense.occurredAt) })),
    ...settlements.map((settlement) => ({ row: { row: "settlement", settlement } as LedgerRow, day: startOfLocalDay(settlement.occurredAt) })),
  ];
  return keyed.sort(({ row: a, day: da }, { row: b, day: db }) => db - da || withinDay(entryOf(a), entryOf(b))
    || (a.row === b.row ? 0 : a.row === "expense" ? -1 : 1)
    || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
}

/**
 * A date line is keyed by the calendar day, not the label, which renames itself
 * at midnight. Labelled once a day, not once a row.
 */
export function ledgerItems(
  expenses: Expense[], settlements: Settlement[], label: (ts: number) => string,
): LedgerItem<LedgerRow>[] {
  const out: LedgerItem<LedgerRow>[] = [];
  let last = NaN;
  for (const { row, day } of dayed(expenses, settlements)) {
    if (day !== last) {
      const d = new Date(day);
      out.push({ key: `day:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, kind: "day", label: label(entryOf(row).occurredAt) });
      last = day;
    }
    out.push({ key: entryOf(row).id, kind: "row", row });
  }
  return out;
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * A comma or dot followed by exactly three digits could be grouping, so both
 * readings are tried.
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

export const SEARCH_TIERS = ["title", "payer", "participant", "currency", "kind", "amount"] as const;
export type SearchTier = typeof SEARCH_TIERS[number];

export interface SearchContext {
  nameOf: (member: string) => string | undefined;
  kindWord: (kind: EntryKind) => string;
  tierLabel: (tier: SearchTier) => string;
  base: string;
}

interface Searched {
  title: string; payer: string; participant: string;
  currency: string; kind: string;
  figures: [string, string];
}

/**
 * By the entry and the context, so a keystroke in a 10,000-entry ledger reads
 * what the last one worked out rather than normalising every row's text again:
 * pass the same context while the names and the currency stand
 * (`searchContextOf`).
 */
const searchedCache = new WeakMap<Expense | Settlement, { context: SearchContext; row: Searched }>();

function searched(row: LedgerRow, context: SearchContext): Searched {
  const entry = entryOf(row);
  const known = searchedCache.get(entry);
  if (known?.context === context) return known.row;
  const out = searchedFresh(row, context);
  searchedCache.set(entry, { context, row: out });
  return out;
}

/** Each member's name normalised once a context, not once a row. */
const plainNames = new WeakMap<SearchContext, Map<string, string | undefined>>();

function plainName(context: SearchContext, id: string): string | undefined {
  let names = plainNames.get(context);
  if (!names) plainNames.set(context, names = new Map());
  if (!names.has(id)) {
    const name = context.nameOf(id);
    names.set(id, name === undefined ? undefined : plain(name));
  }
  return names.get(id);
}

function searchedFresh(row: LedgerRow, context: SearchContext): Searched {
  const { nameOf, kindWord, base } = context;
  const entry = entryOf(row);
  // Normalising each name apart and then joining is normalising the join: the
  // line break between them is untouched by both.
  const names = (ids: string[]) => ids.map((id) => plainName(context, id)).filter(Boolean).join("\n");
  return {
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

/** Where `word` is in `row`: bit `i` for `SEARCH_TIERS[i]`. */
function tiersOf(row: Searched, word: string, figure: boolean): number {
  return (row.title.includes(word) ? 1 : 0)
    | (row.payer.includes(word) ? 2 : 0)
    | (row.participant.includes(word) ? 4 : 0)
    | (row.currency === word ? 8 : 0)
    | (row.kind === word ? 16 : 0)
    | (figure && (figureMatches(word, row.figures[0]) || figureMatches(word, row.figures[1])) ? 32 : 0);
}

/** The lowest set bit's index: the best tier a mask holds. */
function bestOf(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/**
 * Sectioned by the best place any word was found;
 * docs/frontend.md#the-ledgers-search. Within a section, rows matching more
 * words there come first, and then the ledger's own order — kept by dropping
 * each hit straight into its place rather than sorting them.
 */
export function searchLedger(
  items: LedgerItem<LedgerRow>[], query: string, context: SearchContext,
): LedgerItem<LedgerRow>[] {
  const words = [...new Set(plain(query).split(/\s+/).filter(Boolean))];
  if (words.length === 0) return items;
  const figures = words.map((w) => /^\d[\d.,]*$/.test(w));
  const places = words.length + 1;
  const buckets: LedgerItem<LedgerRow>[][] = Array.from({ length: SEARCH_TIERS.length * places }, () => []);
  const masks = new Array<number>(words.length);
  rows: for (const item of items) {
    if (item.kind !== "row") continue;
    const row = searched(item.row, context);
    let all = 0;
    for (let w = 0; w < words.length; w++) {
      const mask = tiersOf(row, words[w]!, figures[w]!);
      if (mask === 0) continue rows;
      masks[w] = mask;
      all |= mask;
    }
    const tier = bestOf(all);
    let count = 0;
    for (const mask of masks) if (mask & (1 << tier)) count++;
    buckets[tier * places + (places - 1 - count)]!.push(item);
  }
  const out: LedgerItem<LedgerRow>[] = [];
  for (let tier = 0; tier < SEARCH_TIERS.length; tier++) {
    const section = buckets.slice(tier * places, (tier + 1) * places).flat();
    if (section.length === 0) continue;
    const name = SEARCH_TIERS[tier]!;
    out.push({ key: `tier:${name}`, kind: "day", label: context.tierLabel(name) });
    out.push(...section);
  }
  return out;
}

/**
 * One context for as long as the names and the currency say the same, across
 * visits and saves alike, so `searchLedger` finds what it worked out still
 * good.
 */
let lastContext: { key: string; context: SearchContext } | null = null;

export function searchContextOf(
  memberById: ReadonlyMap<string, { name: string }>, base: string,
  words: Pick<SearchContext, "kindWord" | "tierLabel">,
): SearchContext {
  let key = base;
  for (const [id, m] of memberById) key += `\u0000${id}\u0001${m.name}`;
  if (lastContext?.key === key) return lastContext.context;
  const context: SearchContext = { ...words, nameOf: (id) => memberById.get(id)?.name, base };
  lastContext = { key, context };
  return context;
}
