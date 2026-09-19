import type { CurrencyCode, Rate } from "./money.js";
import type { Hlc } from "./hlc.js";

export type Id = string;

export type SplitMode = "equal" | "exact" | "shares" | "percent" | "receipt";

/**
 * The modes a person can *type*. `receipt` is excluded: its weights are read
 * off a scanned bill, so nothing converts into it and no editor tab writes it.
 */
export type ArithmeticMode = Exclude<SplitMode, "receipt">;

/**
 * Which way an entry moves money. `income` (a returned deposit, a prize) is
 * structurally identical to an expense — same payers, same split, same
 * positive `amountMinor` — and the sign is applied once, in `computeBalances`.
 * Absent means `expense`. ADR-0010.
 *
 * A **transfer** is not on this union: it is a `Settlement`, with no split at
 * all. The vocabulary naming all three is `apps/web/lib/entry-kind.ts`.
 */
export type ExpenseKind = "expense" | "income";

export type SplitSpec =
  | { mode: "equal"; members: Id[] }
  /** Exact minor amounts in the expense's BASE currency. Must sum to the total. */
  | { mode: "exact"; amounts: Record<Id, number> }
  /** Arbitrary positive weights. 2 shares to one person, 1 to another. */
  | { mode: "shares"; weights: Record<Id, number> }
  /** Basis points (10000 = 100%) so percentages stay integers. */
  | { mode: "percent"; bps: Record<Id, number> }
  /**
   * What a scanned bill says each person had, as weights: every line's amount
   * divided among whoever was ticked for it, plus their share of the tip
   * ([ADR-0016](../../../docs/decisions/0016-receipts.md)).
   *
   * Same arithmetic as `shares`, and a separate mode anyway: a bill read out
   * is not parts somebody chose, and every screen that had to ask which one a
   * `shares` split really was got it wrong somewhere.
   */
  | { mode: "receipt"; weights: Record<Id, number> };

/** A split in one of those modes: whatever an editor tab can hold. */
export type ArithmeticSplit = Extract<SplitSpec, { mode: ArithmeticMode }>;

export interface Group {
  id: Id;
  name: string;
  baseCurrency: CurrencyCode;
  createdAt: number;
  archivedAt?: number | null;
}

export interface Member {
  id: Id;
  groupId: Id;
  name: string;
  /** Stable seed for the member's avatar colour. */
  colorSeed: number;
  deletedAt?: number | null;
}

export interface Expense {
  id: Id;
  groupId: Id;
  /** Which way this entry runs. Absent means `expense`. See `ExpenseKind`. */
  kind?: ExpenseKind | null;
  description: string;
  categoryId?: string | null;
  occurredAt: number;
  /**
   * `occurredAt` is local midnight of a day with no time of day worth showing
   * — a scanned receipt prints a date, not an hour. Saying so beats leaving
   * 00:00 to be read as a time somebody meant. Absent, not `false`, otherwise.
   * docs/data-model.md#a-day-without-a-time.
   */
  dateOnly?: boolean | null;
  /**
   * When this expense was added, wall-clock, set once and never touched by an
   * edit. Breaks ties between same-day expenses in list order; `occurredAt` is
   * the editable purchase date. Absent sorts on `occurredAt` alone.
   */
  createdAt?: number;
  /** Amount in `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Rate to the group's base currency, frozen at entry. "1" when identical. */
  rateToBase: Rate;
  /** amountMinor converted to base currency. Stored, not recomputed. ADR-0005. */
  baseAmountMinor: number;
  /**
   * The single payer, or — when `payers` is set — its largest contributor.
   * Always present: a list row needs one name and one avatar. payers.ts, ADR-0010.
   */
  paidBy: Id;
  /**
   * Co-sponsors. memberId -> amount in THIS EXPENSE'S currency, summing to
   * `amountMinor`. Absent (the common case) means one payer: `paidBy` put in
   * all of it.
   */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  /**
   * Receipt photos. Absent, not `[]`, when there are none — which today is
   * every expense: nothing appends an `attachment` op yet.
   */
  attachmentIds?: Id[];
  /**
   * The last scan's line items, kept on the expense rather than in a local
   * draft so "who had what" reopens on another device or another session.
   * Absent when there was no scan. ADR-0016.
   */
  receiptItems?: ReceiptItem[] | null;
  /** A separate tip/service line from the same scan, printed as-is. */
  receiptTip?: string | null;
  /** Tax charged on top of the lines, printed as-is. `BillExtras`. */
  receiptTax?: string | null;
  /** What the bill took off, one entry per printed deduction. `BillExtras`. */
  receiptDiscounts?: ReceiptDiscount[] | null;
  /** Who was marked present, last time the who-had-what grid was saved. */
  receiptInvolved?: Id[] | null;
  /** Per-item member ids, same order as `receiptItems`, last time it was saved. */
  receiptAssignments?: Id[][] | null;
  /**
   * The bill as typed into "Type it in" rather than photographed
   * (`BILL_TEXT_MAX` caps it). Kept for the same reason `receiptItems` is: the
   * dialog reopens holding it, so correcting a misread bill is an edit and not
   * a retype. Absent on a photographed bill and on one with no scan.
   */
  receiptText?: string | null;
  deletedAt?: number | null;
}

/**
 * One deduction as kept on the expense: what the bill called it, and the
 * positive magnitude it took off. Nobody ordered it, so it carries no
 * assignment — it comes off everybody in proportion to what they did order
 * (`receiptBreakdown`). ADR-0016.
 */
export interface ReceiptDiscount {
  label: string;
  amount: string;
}

/**
 * One line of a scanned bill. `amount` is the printed line total, already
 * multiplied out; `quantity` is what the receipt printed beside it ("2x"),
 * shown and never used as a multiplier. ADR-0016.
 */
export interface ReceiptItem {
  label: string;
  amount: string;
  /** The count printed on the receipt, or null when none was. Display only. */
  quantity?: number | null;
  /**
   * How many portions a printed line was unfolded into on the who-had-what
   * grid — two people shared one of the two salads, the third had the other.
   * Consecutive lines with the same label and count are one unfold, which is
   * what lets them be merged back. ADR-0016.
   */
  portionOf?: number | null;
}

/**
 * A **transfer**: money handed from one person to another, in the real world.
 * Separate from `Expense` so it never inflates what the trip cost — it moves a
 * debt, it does not create one, and the app calls all of them transfers rather
 * than reimbursements
 * ([ADR-0010](../../../docs/decisions/0010-what-an-entry-is.md)).
 *
 * Named `Settlement` because the op log and the D1 `entity` column say
 * `settlement`; renaming it buys a migration and nothing else.
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
  occurredAt: number;
  /** A day and no time of day. Same rule and same reason as `Expense.dateOnly`. */
  dateOnly?: boolean | null;
  /** When this settlement was recorded, wall-clock. Same tiebreak role as `Expense.createdAt`. */
  createdAt?: number;
  note?: string | null;
  deletedAt?: number | null;
}

/**
 * Which member a device says it is, in one group. `id` is the device's HLC
 * node id, the string already ending every op it stamped — so a claim is a
 * *shared* fact, and that is what lets everybody read `Op.actor`. ADR-0003.
 */
export interface Identity {
  /** The device's HLC node id. */
  id: Id;
  groupId: Id;
  /** The member this device claims to be, as of `claimedAt`. */
  memberId: Id;
  claimedAt: number;
}

/** Where a rate came from — the only provenance the app can honestly show. */
export type RateSource = "fetched" | "typed";

/**
 * One line of the group's exchange-rate registry. Entries are valued at it on
 * read, not at the rate in force when they were typed (ADR-0005) — so fixing
 * one rate follows through every entry in that currency.
 *
 * `id` is the currency code, so two phones editing the same currency merge by
 * HLC instead of making a second row. Never written for the base currency.
 */
export interface ExchangeRate {
  /** The currency this values. Doubles as the entity id — one row per currency. */
  id: CurrencyCode;
  groupId: Id;
  /** 1 unit of `id` = `rate` units of the group's base currency. */
  rate: Rate;
  source: RateSource;
  /** The feed's own date for a fetched rate; when it was typed, for a typed one. */
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
  /** Keyed by device node id, not by member: one row per device. */
  identities: Record<Id, Identity>;
  /** The group's exchange-rate registry, keyed by currency code. See `ExchangeRate`. */
  rates: Record<CurrencyCode, ExchangeRate>;
  /** Highest HLC applied. Cheap way to know whether a fold is up to date. */
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

/** Entities that are alive: not tombstoned. */
export function alive<T extends { deletedAt?: number | null }>(
  record: Record<string, T>,
): T[] {
  return Object.values(record).filter((e) => !e.deletedAt);
}
