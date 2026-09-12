import type { CurrencyCode, Rate } from "./money.js";
import type { Hlc } from "./hlc.js";

export type Id = string;

export type SplitMode = "equal" | "exact" | "shares" | "percent" | "receipt";

/**
 * Every mode a person can *type*: the four that are somebody's arithmetic.
 *
 * `receipt` is the one that isn't — its weights are read off a scanned bill,
 * never entered — so it is the one mode nothing converts into
 * (`convertSplitMode`) and no editor tab writes.
 */
export type ArithmeticMode = Exclude<SplitMode, "receipt">;

/**
 * Which way an entry moves money through the group.
 *
 * - `expense` — somebody paid out, and it is shared between the people it was
 *   spent on. The default, and what an entry written before this field existed
 *   is: absent means `expense`, forever.
 * - `income` — somebody took money *in* on the group's behalf (a deposit
 *   returned, a prize, a sold ticket) and it is shared between the people it
 *   belongs to. Structurally identical to an expense — same payers, same
 *   split, same positive `amountMinor` — and the sign is applied once, in
 *   `computeBalances`. That is the whole of the difference. ADR-0010.
 *
 * The third kind of entry a person can add, a **transfer**, is not on this
 * union: it is a `Settlement`, a different entity with no split at all. The
 * app-level vocabulary that does name all three is `apps/web/lib/entry-kind.ts`.
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
   * What a scanned bill says each person had, as weights: every line's
   * amount divided among whoever was ticked for it, plus their share of the
   * tip ([ADR-0016](../../../docs/decisions/0016-receipts.md)).
   *
   * Weighted division is the same arithmetic `shares` does, and that is the
   * whole of what they have in common: one is a bill read out, the other is
   * parts somebody chose. They were the same mode once, distinguished by a
   * second field, and every screen that had to ask that second field what a
   * `shares` split *really* was got it wrong somewhere — the entry read "as
   * parts", the history said "Teo ×3943 parts", leaving Receipt for As parts
   * arrived with the bill's weights already typed in. A receipt is its own
   * mode, and nothing has to ask.
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
  /**
   * Which way this entry runs. Absent means `expense` — every op written
   * before incomes existed, and every ordinary expense since, so the common
   * case never carries the field. See `ExpenseKind`.
   */
  kind?: ExpenseKind | null;
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
  /**
   * Receipt photos on this expense. Absent — not `[]` — when there are none,
   * which today is every expense: nothing appends an `attachment` op yet.
   */
  attachmentIds?: Id[];
  /**
   * The last receipt scan's line items, kept on the expense (not just a local
   * draft) so "who had what" can be reopened later — another device, another
   * session — instead of the parsed bill being thrown away once `split` is
   * computed from it. Absent on an expense with no scan. ADR-0016.
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
  deletedAt?: number | null;
}

/**
 * One line of a scanned bill, as kept on the expense. ADR-0016.
 *
 * `amount` is the line's printed total, already multiplied out — `quantity` is
 * what the receipt printed next to it ("2x", a qty column) and is never used
 * as a multiplier, only shown.
 */
/**
 * One deduction as kept on the expense: what the bill called it, and the
 * positive magnitude it took off. ADR-0016.
 *
 * Nobody ordered it, so it carries no assignment — it comes off everybody in
 * proportion to what they did order (`receiptBreakdown`).
 */
export interface ReceiptDiscount {
  label: string;
  amount: string;
}

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
   * unfold, which is what lets it be merged back. ADR-0016.
   */
  portionOf?: number | null;
}

/**
 * A **transfer**: money handed from one person to another, in the real world.
 *
 * Kept separate from `Expense` so it never inflates what the trip cost — it
 * moves a debt, it does not create one. Paying somebody back is the reason
 * most transfers exist, but not the only one, which is why the app calls all
 * of them transfers and reserves "reimbursement" for none of them
 * ([ADR-0010](../../../docs/decisions/0010-what-an-entry-is.md)). The type
 * keeps its old name because the op log, the D1 `entity` column and every op
 * ever written say `settlement`; renaming it would be a migration bought with
 * nothing.
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
 * ADR-0003.
 */
export interface Identity {
  /** The device's HLC node id. */
  id: Id;
  groupId: Id;
  /** The member this device claims to be, as of `claimedAt`. */
  memberId: Id;
  claimedAt: number;
}

/**
 * Where a rate in the registry came from, which is the only thing the app can
 * honestly say about a number it is converting money with.
 */
export type RateSource = "fetched" | "typed";

/**
 * One line of the group's exchange-rate registry: what a currency is worth,
 * for everybody in the group, right now.
 *
 * The registry is **the** answer to "what is 500 MAD in euros" — entries are
 * valued at it on read, not at whatever rate happened to be in force the day
 * somebody typed them (ADR-0005). That is what makes it worth correcting: fix
 * the rate once and every MAD entry in the ledger follows.
 *
 * `id` is the currency code, so there is exactly one row per currency and two
 * phones editing the same one merge by HLC like any other entity rather than
 * making a second row. A row for the group's own base currency is meaningless
 * and is never written.
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
