import type { CurrencyCode, Rate } from "./money.js";
import type { Hlc } from "./hlc.js";

export type Id = string;

export type SplitMode = "equal" | "exact" | "shares" | "percent" | "receipt";

/** `receipt`'s weights are read off a scanned bill: no editor tab writes it. */
export type ArithmeticMode = Exclude<SplitMode, "receipt">;

/**
 * `income` is an expense whose sign is applied once, in `computeBalances`;
 * absent means `expense`. A transfer is a `Settlement`. ADR-0010.
 */
export type ExpenseKind = "expense" | "income";

export type SplitSpec =
  | { mode: "equal"; members: Id[] }
  /**
   * In the entry's own currency, summing to `amountMinor`; the base total is
   * apportioned by them. `rest` are the rows nobody typed a figure for: they
   * share what the typed ones leave, evenly, and their `amounts` are written
   * filled in so a reader that predates `rest` still sees a whole split.
   */
  | { mode: "exact"; amounts: Record<Id, number>; rest?: Id[] }
  | { mode: "shares"; weights: Record<Id, number> }
  /** Basis points (10000 = 100%) so percentages stay integers. */
  | { mode: "percent"; bps: Record<Id, number> }
  /** `shares` arithmetic, kept apart because a bill read out is not parts somebody chose. ADR-0016. */
  | { mode: "receipt"; weights: Record<Id, number> };

export type ArithmeticSplit = Extract<SplitSpec, { mode: ArithmeticMode }>;

export interface Group {
  id: Id;
  name: string;
  baseCurrency: CurrencyCode;
  createdAt: number;
  archivedAt?: number | null;
  importedFrom?: ImportSource | null;
}

/** `file` is any spreadsheet: Splitwise's, bida's, Tricount's. */
export type ImportSource = "tricount" | "file";

export interface Member {
  id: Id;
  groupId: Id;
  name: string;
  /** Stable seed for the member's avatar colour. */
  colorSeed: number;
  deletedAt?: number | null;
}

/** The bill behind an expense, kept on it so "who had what" reopens on any device. ADR-0016. */
export interface Receipt {
  receiptItems?: ReceiptItem[] | null;
  receiptTip?: string | null;
  /** Charged on top of the lines. */
  receiptTax?: string | null;
  receiptDiscounts?: ReceiptDiscount[] | null;
  receiptInvolved?: Id[] | null;
  /** Parallel to `receiptItems`. */
  receiptAssignments?: Id[][] | null;
  /** The bill as typed into "Type it in". */
  receiptText?: string | null;
  /** The translate toggle, saved so every phone reads the bill alike (`billLabel`). Written only when true. */
  receiptEnglish?: boolean | null;
}

export interface Expense extends Receipt {
  id: Id;
  groupId: Id;
  kind?: ExpenseKind | null;
  description: string;
  categoryId?: string | null;
  occurredAt: number;
  /**
   * `occurredAt` is local midnight of a day with no time. Absent, not `false`,
   * otherwise. docs/data-model.md#a-day-without-a-time.
   */
  dateOnly?: boolean | null;
  /** Never touched by an edit: breaks same-day ties in list order. */
  createdAt?: number;
  amountMinor: number;
  currency: CurrencyCode;
  /** "1" when `currency` is the base. The entry's own, frozen at save. ADR-0005. */
  rateToBase: Rate;
  /** `amountMinor` × `rateToBase`, rounded once. Re-derived on read (`atCurrentRates`). */
  baseAmountMinor: number;
  /** Where `rateToBase` came from. Absent on a base-currency entry, and on one written before rates were the entry's. */
  rateSource?: EntryRateSource | null;
  /** The largest payer when `payers` is set. Always present: a row needs one name. */
  paidBy: Id;
  /** In `currency`, summing to `amountMinor`. Absent means `paidBy` paid it all. */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  /** Absent, not `[]`: nothing appends an `attachment` op yet. */
  attachmentIds?: Id[];
  deletedAt?: number | null;
}

/** A positive magnitude, taken off everybody in proportion to what they ordered. ADR-0016. */
export interface ReceiptDiscount {
  label: string;
  amount: string;
  /** Absent on an English bill. `receiptEnglish` picks which label shows. */
  labelEn?: string | null;
}

/** `amount` is the printed line total; `quantity` ("2x") is shown and never multiplied. ADR-0016. */
export interface ReceiptItem {
  /** In the bill's own language. */
  label: string;
  labelEn?: string | null;
  amount: string;
  quantity?: number | null;
  /** Portions a line was unfolded into; consecutive lines with the same label and count merge back. */
  portionOf?: number | null;
}

/**
 * A transfer, kept apart from `Expense` so it never inflates what the trip
 * cost (ADR-0010). The op log says `settlement`; renaming buys only a migration.
 */
export interface Settlement {
  id: Id;
  groupId: Id;
  fromMember: Id;
  toMember: Id;
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  baseAmountMinor: number;
  /** As `Expense.rateSource`. */
  rateSource?: EntryRateSource | null;
  occurredAt: number;
  /** As `Expense.dateOnly`. */
  dateOnly?: boolean | null;
  /** As `Expense.createdAt`. */
  createdAt?: number;
  note?: string | null;
  deletedAt?: number | null;
}

/**
 * Which member a device says it is. `id` is the device's HLC node id, which
 * ends every op it stamped — which is what lets everybody read `Op.actor`. ADR-0003.
 */
export interface Identity {
  id: Id;
  groupId: Id;
  memberId: Id;
  claimedAt: number;
  /** Null once it stopped listening, absent if it never asked. docs/notifications.md. */
  push?: DevicePush | null;
}

/** A setting of the phone, so every group's identity carries the same one. "Nothing" is no subscription. */
export type NotifyScope = "own" | "all";

/** What a sender needs to encrypt to one device (RFC 8291). */
export interface DevicePush {
  endpoint: string;
  /** P-256, base64url, uncompressed. */
  p256dh: string;
  /** 16 bytes, base64url. */
  auth: string;
  /** Absent reads as "own". */
  scope?: NotifyScope;
}

export type RateSource = "fetched" | "typed";

/**
 * Where an entry's own rate came from: the feed for its day, a person, the
 * group's latest entry in that currency when the feed failed, the ledger it
 * was imported from, or the registry an entry written before rates were the
 * entry's was valued at. ADR-0005.
 */
export type EntryRateSource = RateSource | "copied" | "imported" | "group";

/**
 * The registry rates used to live in, before each entry carried its own. No
 * screen writes one now; the rows production holds still fold, and
 * `entriesCarryTheirOwnRate` writes each onto the entries it valued (ADR-0005).
 * Never the base currency.
 */
export interface ExchangeRate {
  /** The currency, as the id, so two phones editing one currency merge. */
  id: CurrencyCode;
  groupId: Id;
  /** 1 `id` = `rate` of the base currency. */
  rate: Rate;
  source: RateSource;
  /** The feed's own date, or when it was typed. */
  asOf: number;
  deletedAt?: number | null;
}

export type UploadState = "local" | "uploading" | "uploaded";

export interface Attachment {
  id: Id;
  groupId: Id;
  expenseId: Id;
  r2Key?: string | null;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  uploadState: UploadState;
  createdAt: number;
  deletedAt?: number | null;
}

export interface GroupState {
  group: Group | undefined;
  members: Record<Id, Member>;
  expenses: Record<Id, Expense>;
  settlements: Record<Id, Settlement>;
  attachments: Record<Id, Attachment>;
  /** One per device, not per member. */
  identities: Record<Id, Identity>;
  rates: Record<CurrencyCode, ExchangeRate>;
  /** Highest applied: tells whether a fold is up to date. */
  lastHlc: Hlc | undefined;
}

export function emptyGroupState(): GroupState {
  return {
    group: undefined,
    members: {},
    expenses: {},
    settlements: {},
    attachments: {},
    identities: {},
    rates: {},
    lastHlc: undefined,
  };
}

/**
 * For readers holding rows rather than a log: a hand-built state missing a
 * field is wrong in a way nothing catches. Unpriced, tombstones kept.
 */
export function stateFromRows(rows: {
  group: Group | undefined;
  members?: readonly Member[];
  expenses?: readonly Expense[];
  settlements?: readonly Settlement[];
  rates?: readonly ExchangeRate[];
}): GroupState {
  const byId = <T extends { id: string }>(list: readonly T[] = []) =>
    Object.fromEntries(list.map((row) => [row.id, row]));
  return {
    ...emptyGroupState(),
    group: rows.group,
    members: byId(rows.members),
    expenses: byId(rows.expenses),
    settlements: byId(rows.settlements),
    rates: byId(rows.rates),
  };
}

/** Not tombstoned. */
export function alive<T extends { deletedAt?: number | null }>(
  record: Record<string, T>,
): T[] {
  return Object.values(record).filter((e) => !e.deletedAt);
}
