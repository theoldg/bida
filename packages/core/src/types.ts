import type { CurrencyCode, Rate } from "./money.js";
import type { Hlc } from "./hlc.js";

export type Id = string;

export type SplitMode = "equal" | "exact" | "shares" | "percent";

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
  deletedAt?: number | null;
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
