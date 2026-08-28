import type { CurrencyCode, Rate } from "./money.js";
import type { Hlc } from "./hlc.js";

export type Id = string;

export type SplitMode = "equal" | "exact" | "shares" | "percent";

/**
 * Which of the split editor's four tabs is showing, independent of
 * `SplitSpec["mode"]` — a finished who-had-what grid writes an ordinary
 * `shares` spec, but the tab should still read "Receipt", not "As parts".
 * Persisted on `Expense` (not just the local draft) so leaving Receipt mode
 * for one of the other three sticks after save; absent means "derive it from
 * the data" for expenses saved before this field existed.
 */
export type SplitTab = "equal" | "shares" | "exact" | "receipt";

export type SplitSpec =
  | { mode: "equal"; members: Id[] }
  /** Exact minor amounts in the expense's BASE currency. Must sum to the total. */
  | { mode: "exact"; amounts: Record<Id, number> }
  /** Arbitrary positive weights. 2 shares to one person, 1 to another. */
  | { mode: "shares"; weights: Record<Id, number> }
  /** Basis points (10000 = 100%) so percentages stay integers. */
  | { mode: "percent"; bps: Record<Id, number> };

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
  description: string;
  categoryId?: string | null;
  occurredAt: number;
  /**
   * When this expense was first added, wall-clock, set once and never
   * touched by later edits. `occurredAt` is the (editable) date of the
   * purchase; this is for breaking ties between same-day expenses in list
   * order. Optional so expenses written before this field existed still fold
   * and display fine — the list sort falls back to `occurredAt` for those.
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
   * Always present: every op ever written carries it, and a list row needs one
   * name and one avatar. See payers.ts and ADR-0010.
   */
  paidBy: Id;
  /**
   * Co-sponsors. memberId -> amount in THIS EXPENSE'S currency, summing to
   * `amountMinor`. Absent (the common case) means one payer: `paidBy` put in
   * all of it.
   */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  attachmentIds: Id[];
  /**
   * The last receipt scan's line items, kept on the expense (not just a local
   * draft) so "who had what" can be reopened later — another device, another
   * session — instead of the parsed bill being thrown away once `split` is
   * computed from it. Absent on an expense with no scan. ADR-0017.
   */
  receiptItems?: ReceiptItem[] | null;
  /** A separate tip/service line from the same scan, printed as-is. */
  receiptTip?: string | null;
  /** Who was marked present, last time the who-had-what grid was saved. */
  receiptInvolved?: Id[] | null;
  /** Per-item member ids, same order as `receiptItems`, last time it was saved. */
  receiptAssignments?: Id[][] | null;
  /** Which split tab was showing, last time this expense was saved. See `SplitTab`. */
  splitTab?: SplitTab | null;
  deletedAt?: number | null;
}

/**
 * One line of a scanned bill, as kept on the expense. ADR-0017.
 *
 * `amount` is the line's printed total, already multiplied out — `quantity` is
 * what the receipt printed next to it ("2x", a qty column) and is never used
 * as a multiplier, only shown.
 */
export interface ReceiptItem {
  label: string;
  amount: string;
  /** The count printed on the receipt, or null when none was. Display only. */
  quantity?: number | null;
  /**
   * Set when this line is one portion of a printed line that was unfolded on
   * the who-had-what grid — two people shared one of the two salads, the
   * third had the other — and how many portions it was unfolded into.
   * Consecutive lines carrying the same label and the same count are one such
   * unfold, which is what lets it be merged back. ADR-0022.
   */
  portionOf?: number | null;
}

/** A real-world reimbursement. Kept separate so it never inflates trip cost. */
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
  /** When this settlement was recorded, wall-clock. Same tiebreak role as `Expense.createdAt`. */
  createdAt?: number;
  note?: string | null;
  deletedAt?: number | null;
}

/**
 * Which member a device says it is, in one group.
 *
 * `id` is the device's HLC node id — the same string that already ends every
 * op that device stamped. Claiming an identity is therefore a *shared* fact,
 * not a private one: it is what lets everybody read `Op.actor` honestly. See
 * ADR-0011.
 */
export interface Identity {
  /** The device's HLC node id. */
  id: Id;
  groupId: Id;
  /** The member this device claims to be, as of `claimedAt`. */
  memberId: Id;
  claimedAt: number;
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
    lastHlc: undefined,
  };
}

/** Entities that are alive: not tombstoned. */
export function alive<T extends { deletedAt?: number | null }>(
  record: Record<string, T>,
): T[] {
  return Object.values(record).filter((e) => !e.deletedAt);
}
