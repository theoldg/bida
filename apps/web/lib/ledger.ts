// Doc: docs/data-model.md#a-day-without-a-time
import { minorToDecimalString, payerList, splitParticipants, type Expense, type Settlement } from "@bida/core";
import { kindOf, type EntryKind } from "./entry-kind";
import { byWhen } from "./format";
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
  const id = (row: LedgerRow) => entryOf(row).id;
  return [
    ...expenses.map((expense): LedgerRow => ({ row: "expense", expense })),
    ...settlements.map((settlement): LedgerRow => ({ row: "settlement", settlement })),
  ].sort((a, b) => byWhen(entryOf(a), entryOf(b))
    || (a.row === b.row ? 0 : a.row === "expense" ? -1 : 1)
    || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
}

/**
 * A date line is keyed by the calendar day, not the label, which renames itself
 * at midnight.
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
 * pass the same context while the names and the currency stand.
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

function searchedFresh(row: LedgerRow, { nameOf, kindWord, base }: SearchContext): Searched {
  const entry = entryOf(row);
  const names = (ids: string[]) => plain(ids.map(nameOf).filter(Boolean).join("\n"));
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
 * Sectioned by the best place any word was found;
 * docs/frontend.md#the-ledgers-search.
 */
export function searchLedger(
  items: LedgerItem<LedgerRow>[], query: string, context: SearchContext,
): LedgerItem<LedgerRow>[] {
  const words = [...new Set(plain(query).split(/\s+/).filter(Boolean))];
  if (words.length === 0) return items;
  const hits: { item: LedgerItem<LedgerRow>; tier: number; count: number }[] = [];
  for (const item of items) {
    if (item.kind !== "row") continue;
    const row = searched(item.row, context);
    const found = words.map((w) => tiersOf(row, w));
    if (found.some((tiers) => tiers.length === 0)) continue;
    const tier = Math.min(...found.flat().map((t) => SEARCH_TIERS.indexOf(t)));
    hits.push({ item, tier, count: found.filter((tiers) => tiers.includes(SEARCH_TIERS[tier]!)).length });
  }
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
