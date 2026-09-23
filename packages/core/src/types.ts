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
 * Which way an entry moves money. `income` is structurally an expense — same
 * payers, split and positive `amountMinor` — with the sign applied once, in
 * `computeBalances`. Absent means `expense`. A transfer is a `Settlement`.
 * ADR-0010.
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
   * A scanned bill's weights: each line divided among whoever had it, plus
   * their tip share (ADR-0016). Same arithmetic as `shares`, kept separate
   * because a bill read out is not parts somebody chose.
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
   * `occurredAt` is local midnight of a day with no meaningful time (a receipt
   * prints a date, not an hour). Absent, not `false`, otherwise.
   * docs/data-model.md#a-day-without-a-time.
   */
  dateOnly?: boolean | null;
  /**
   * When this was added, wall-clock, never touched by an edit. Breaks same-day
   * ties in list order; `occurredAt` is the editable date.
   */
  createdAt?: number;
  /** Amount in `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Rate to the group's base currency, frozen at entry. "1" when identical. */
  rateToBase: Rate;
  /** amountMinor converted to base currency. Stored, not recomputed. ADR-0005. */
  baseAmountMinor: number;
  /** The single payer, or the largest one when `payers` is set. Always present: a row needs one name. */
  paidBy: Id;
  /** Co-payers: memberId -> amount in this expense's currency, summing to `amountMinor`. Absent means `paidBy` paid it all. */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  /** Receipt photos. Absent, not `[]`, when none — nothing appends an `attachment` op yet. */
  attachmentIds?: Id[];
  /** The last scan's lines, on the expense so "who had what" reopens on any device. ADR-0016. */
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
  /** The bill as typed into "Type it in", so the dialog reopens holding it. */
  receiptText?: string | null;
  deletedAt?: number | null;
}

/**
 * One deduction on the bill, as a positive magnitude. Nobody ordered it, so
 * it comes off everybody in proportion to what they did order. ADR-0016.
 */
export interface ReceiptDiscount {
  label: string;
  amount: string;
  /**
   * The English of `label`, kept beside the original: which one shows is a
   * device preference (`billLabel`). Absent on an English bill and on older ones.
   */
  labelEn?: string | null;
}

/**
 * One line of a scanned bill. `amount` is the printed line total; `quantity`
 * ("2x") is shown and never multiplied. ADR-0016.
 */
export interface ReceiptItem {
  /** As the bill printed it, in the bill's own language. */
  label: string;
  /** The English of `label`, or absent when the bill is already English. `ReceiptDiscount.labelEn`. */
  labelEn?: string | null;
  amount: string;
  /** The count printed on the receipt, or null when none was. Display only. */
  quantity?: number | null;
  /**
   * How many portions a line was unfolded into on the grid. Consecutive lines
   * with the same label and count are one unfold, which lets them merge back.
   */
  portionOf?: number | null;
}

/**
 * A **transfer**: money handed between people. Separate from `Expense` so it
 * never inflates what the trip cost (ADR-0010). Named `Settlement` because the
 * op log says `settlement`; renaming it buys a migration and nothing else.
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
 * Which member a device says it is. `id` is the device's HLC node id, which
 * ends every op it stamped — which is what lets everybody read `Op.actor`. ADR-0003.
 */
export interface Identity {
  /** The device's HLC node id. */
  id: Id;
  groupId: Id;
  /** The member this device claims to be, as of `claimedAt`. */
  memberId: Id;
  claimedAt: number;
  /**
   * This device's Web Push subscription, or null once it stopped listening.
   * Absent on a device that never asked. docs/notifications.md.
   */
  push?: PushSubscriptionKeys | null;
}

/** What a sender needs to encrypt to one device (RFC 8291) and address it. */
export interface PushSubscriptionKeys {
  endpoint: string;
  /** The device's P-256 public key, base64url, uncompressed. */
  p256dh: string;
  /** The 16-byte auth secret, base64url. */
  auth: string;
}

/** Where a rate came from — the only provenance the app can honestly show. */
export type RateSource = "fetched" | "typed";

/**
 * One line of the group's rate registry. Entries are valued at it on read
 * (ADR-0005), so fixing a rate follows through every entry. `id` is the
 * currency code so two phones editing one currency merge. Never the base.
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
