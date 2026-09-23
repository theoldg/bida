import { payerList, resolvePayers } from "./payers.js";
import type { Op } from "./ops.js";
import { atCurrentRates } from "./rates.js";
import { canonicalSplit, resolveSplit, splitParticipants } from "./split.js";
import type { CurrencyCode } from "./money.js";
import type { Expense, GroupState, Id, Settlement, SplitSpec } from "./types.js";

/**
 * Who hears about a command, and what about (docs/notifications.md#what-is-said).
 * Facts, not sentences: core is copy-free, so the phone that sends turns each
 * `Notice` into words with `copy.notify`, and bundles a round's worth per
 * recipient.
 *
 * Only the entities the command's own ops name are looked at, never a diff of
 * the whole group — a rate the command also moved would otherwise reprice, and
 * "change", every entry in that currency.
 */

/** An entry as a notification sees it: at today's rates, the recipient's side worked out. */
export type NoticeEntry =
  | {
    kind: "expense" | "income";
    id: Id;
    description: string;
    amountMinor: number;
    currency: CurrencyCode;
    baseAmountMinor: number;
    /** The recipient's share in base minor units, or null when they're not in the split. */
    share: number | null;
    /** What the recipient put in (received, on an income), base minor units; null when nothing. */
    paid: number | null;
  }
  | {
    kind: "transfer";
    id: Id;
    fromMember: Id;
    toMember: Id;
    amountMinor: number;
    currency: CurrencyCode;
    baseAmountMinor: number;
  };

export type NoticeChange = "added" | "edited" | "deleted" | "converted";

/** The fields whose change is news — `describe()`'s "money moved". */
export type MovedField = "amount" | "currency" | "split" | "payers" | "kind" | "sides";

export interface Notice {
  /** The member told. Never the author. */
  to: Id;
  /** The author, whose command this is. */
  by: Id;
  change: NoticeChange;
  /** Absent on an add. */
  before?: NoticeEntry;
  /** Absent on a delete. */
  after?: NoticeEntry;
  /** On an edit, what moved. Empty otherwise. */
  moved: MovedField[];
  /** The group's base, which every `share`, `paid` and `baseAmountMinor` is in. */
  baseCurrency: CurrencyCode;
}

type Entry = { kind: "expense"; row: Expense } | { kind: "settlement"; row: Settlement };

function entryOf(state: GroupState, op: Op): Entry | undefined {
  if (op.entity === "expense") {
    const row = state.expenses[op.entityId];
    return row && !row.deletedAt ? { kind: "expense", row } : undefined;
  }
  if (op.entity === "settlement") {
    const row = state.settlements[op.entityId];
    return row && !row.deletedAt ? { kind: "settlement", row } : undefined;
  }
  return undefined;
}

/** Who an entry concerns: in the split or among the payers, or a side of a transfer. */
function involved(entry: Entry | undefined): Id[] {
  if (!entry) return [];
  if (entry.kind === "settlement") return [entry.row.fromMember, entry.row.toMember];
  return [...payerList(entry.row), ...splitParticipants(entry.row.split)];
}

/** Shares at one total, so a mode swap that means the same thing isn't a move. */
function sharesAt(total: number, split: SplitSpec, seed: Id): string {
  try {
    const { shares } = resolveSplit(total, split, { tiebreakSeed: seed });
    return JSON.stringify(Object.keys(shares).sort().map((id) => [id, shares[id]]));
  } catch {
    return JSON.stringify(canonicalSplit(split));
  }
}

/** Who put in what at one total, for the same reason. */
function payersAt(total: number, e: Expense): string {
  const paid = resolvePayers({ ...e, baseAmountMinor: total });
  return JSON.stringify(Object.keys(paid).sort().map((id) => [id, paid[id]]));
}

function moved(before: Entry, after: Entry): MovedField[] {
  const out: MovedField[] = [];
  const a = before.row, b = after.row;
  if (a.amountMinor !== b.amountMinor) out.push("amount");
  if (a.currency !== b.currency) out.push("currency");
  if (before.kind === "expense" && after.kind === "expense") {
    const total = after.row.baseAmountMinor;
    if (sharesAt(total, before.row.split, before.row.id) !== sharesAt(total, after.row.split, after.row.id)) {
      out.push("split");
    }
    if (payersAt(total, before.row) !== payersAt(total, after.row)) out.push("payers");
    if ((before.row.kind ?? null) !== (after.row.kind ?? null)) out.push("kind");
  }
  if (before.kind === "settlement" && after.kind === "settlement"
    && (before.row.fromMember !== after.row.fromMember
      || before.row.toMember !== after.row.toMember)) out.push("sides");
  return out;
}

/** An entry from one member's seat. A split that won't resolve reads as no share. */
function seen(entry: Entry, to: Id): NoticeEntry {
  if (entry.kind === "settlement") {
    const s = entry.row;
    return {
      kind: "transfer", id: s.id, fromMember: s.fromMember, toMember: s.toMember,
      amountMinor: s.amountMinor, currency: s.currency, baseAmountMinor: s.baseAmountMinor,
    };
  }
  const e = entry.row;
  let share: number | null = null;
  if (splitParticipants(e.split).includes(to)) {
    try {
      // Seeded with the id, as `computeBalances` is, so the cent lands where the ledger puts it.
      share = resolveSplit(e.baseAmountMinor, e.split, { tiebreakSeed: e.id }).shares[to] ?? 0;
    } catch {
      share = null;
    }
  }
  return {
    kind: e.kind === "income" ? "income" : "expense",
    id: e.id, description: e.description,
    amountMinor: e.amountMinor, currency: e.currency, baseAmountMinor: e.baseAmountMinor,
    share, paid: resolvePayers(e)[to] ?? null,
  };
}

/**
 * The notices one command causes. `before` and `after` are the group folded
 * without and with `ops`, the command's own; `me` is its author. A convert is
 * one command writing a delete and a create, so it pairs them.
 */
export function notices(before: GroupState, after: GroupState, ops: readonly Op[], me: Id): Notice[] {
  const baseCurrency = after.group?.baseCurrency ?? before.group?.baseCurrency;
  if (!baseCurrency) return [];
  const was = atCurrentRates(before);
  const now = atCurrentRates(after);

  // What this command did to each entry it named, in the order it named them.
  const changes: { change: NoticeChange; before?: Entry; after?: Entry }[] = [];
  const seenIds = new Set<Id>();
  for (const op of ops) {
    if (seenIds.has(op.entityId)) continue;
    seenIds.add(op.entityId);
    const a = entryOf(was, op);
    const b = entryOf(now, op);
    if (!a && b) changes.push({ change: "added", after: b });
    else if (a && !b) changes.push({ change: "deleted", before: a });
    else if (a && b) changes.push({ change: "edited", before: a, after: b });
  }
  const gone = changes.filter((c) => c.change === "deleted");
  const born = changes.filter((c) => c.change === "added");
  if (changes.length === 2 && gone.length === 1 && born.length === 1
    && gone[0]!.before!.kind !== born[0]!.after!.kind) {
    changes.splice(0, 2, { change: "converted", before: gone[0]!.before, after: born[0]!.after });
  }

  const out: Notice[] = [];
  for (const c of changes) {
    const movedFields = c.change === "edited" ? moved(c.before!, c.after!) : [];
    if (c.change === "edited" && movedFields.length === 0) continue;
    const people = new Set([...involved(c.before), ...involved(c.after)]);
    people.delete(me);
    for (const to of [...people].sort()) {
      // Somebody removed from the group since is nobody to tell.
      const member = now.members[to];
      if (!member || member.deletedAt) continue;
      out.push({
        to, by: me, change: c.change,
        ...(c.before ? { before: seen(c.before, to) } : {}),
        ...(c.after ? { after: seen(c.after, to) } : {}),
        moved: movedFields,
        baseCurrency,
      });
    }
  }
  return out;
}
