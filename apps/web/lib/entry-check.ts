import {
  convertMinor, rateFor, splitParticipants, validatePayers, validateSplit,
  type CurrencyCode, type ExchangeRate, type Rate, type SplitSpec,
} from "@bida/core";
import {
  activeSplit, activeSplitTab, draftAmountMinor, draftReceiptSplit, draftReceiptTotal,
  splitSeed, type EntryDraft, type SplitTab,
} from "./draft";
import { copy } from "./copy";
import { payerProblemText } from "./format";

/**
 * What the entry being typed is worth, and whether it may be saved. It
 * decides money, so it is a tested function rather than `const`s in a render
 * body ([CLAUDE.md](../../../CLAUDE.md)).
 *
 * **Nothing here writes.**
 */

interface EntryCheck {
  /** What the entry is worth in its *own* currency, minor units. */
  amountMinor: number;
  /** The entry in the group's base currency. 0 when it cannot be converted. */
  baseMinor: number;
  /** True when the entry is not written in the group's base currency. */
  foreign: boolean;
  /** The group's rate for this currency, or undefined if it has never said. */
  groupRate: Rate | undefined;
  /** False when amount × rate leaves the safe integer range — see `tryConvertMinor`. */
  rateOk: boolean;
  /** Which split-editor tab the draft is on. */
  activeTab: SplitTab;
  /** A bill is a thing an expense has: an income has no total to read off one. */
  canScan: boolean;
  /** The receipt's own total while Receipt mode is deriving it, else null. */
  receiptTotal: number | null;
  /**
   * Whether the amount field is the receipt's to fill: only on a real, positive
   * derived number, never merely on having items — a disabled *and* empty field
   * would leave nothing to type and a Save that never lights.
   */
  receiptLocksAmount: boolean;
  /** True while Receipt mode is showing a bill it actually has. */
  onReceiptTab: boolean;
  /** What the tab now showing holds — the rows the split editor draws. */
  activeSplit: SplitSpec;
  /**
   * The split read off the bill, or null until the grid says who had what.
   * Never touches the three arithmetic tabs (`SplitInputs`).
   */
  receiptSplit: SplitSpec | null;
  /** The split that would be saved: the receipt's where it has one, else the tab's. */
  effectiveSplit: SplitSpec;
  /** The one sentence saying why Save is grey, or null when nothing is wrong. */
  blocker: string | null;
  /** No amount typed yet — held back from `blocker` since it names no sentence, only a field. */
  amountMissing: boolean;
  /** No title typed yet (expenses/incomes only — a transfer's note is optional). */
  titleMissing: boolean;
  /**
   * Receipt mode hasn't produced its split. A missing step, like
   * `amountMissing`: it blooms the control that takes the step and says nothing
   * in words.
   */
  receiptMissing: boolean;
  /** Whether Save may light. */
  ready: boolean;
}

/** `convertMinor`, or null when the product doesn't fit in a safe integer. */
function tryConvertMinor(
  minor: number, from: string, to: string, rate: Rate,
): number | null {
  try {
    return convertMinor(minor, from, to, rate);
  } catch {
    return null;
  }
}

/**
 * True when the group has no rate for this currency — the entry can't be
 * converted, and the rate dialog opens. Separate from `checkEntry` because
 * the scan asks before there is a draft to check.
 */
export function needsRate(
  rates: Record<string, ExchangeRate>,
  base: CurrencyCode | undefined,
  currency: string,
): boolean {
  return !!base && currency !== base && rateFor(rates, base, currency) === undefined;
}

export function checkEntry(input: {
  draft: EntryDraft;
  /** The group's base currency. */
  base: CurrencyCode;
  /** The group's rate registry, keyed by currency code. */
  rates: Record<string, ExchangeRate>;
  /** Ids of the members still in the group — a removed one is not a valid side. */
  liveMembers: readonly string[];
  /** Their name, for the sentence that names whoever has left. */
  nameOf: (id: string) => string;
}): EntryCheck {
  const { draft, base, rates, nameOf } = input;
  const kind = draft.kind;
  const transfer = kind === "transfer";
  const activeTab = activeSplitTab(draft);

  const canScan = kind === "expense";
  const hasReceiptItems = (draft.receiptItems?.length ?? 0) > 0;
  const onReceiptTab = canScan && activeTab === "receipt" && hasReceiptItems;

  // Derived where it is read, never cached into the draft (ADR-0016).
  const receiptTotal = draftReceiptTotal(draft);
  // Null until the grid has been filled; the arithmetic tab behind it is what
  // a save would write, and `receiptBlocker` refuses that.
  const receiptSplit = draftReceiptSplit(draft);
  const tabSplit = activeSplit(draft);
  const effectiveSplit = receiptSplit ?? tabSplit;

  // The same question the payers editor asks, answered by the same function.
  const amountMinor = draftAmountMinor(draft);

  const foreign = draft.currency !== base;
  // The rate is the group's, from the registry — never a form field, never
  // frozen onto the entry (ADR-0005). Undefined means unknown; defaulting to
  // `"1"` banks a 500 MAD dinner as €500.
  const groupRate = rateFor(rates, base, draft.currency);
  // An amount and a rate can each be in range and still multiply out of it.
  // An out-of-range conversion is "no base amount yet", the state a missing
  // rate already produces: the figure reads "—" and Save stays held.
  const converted = foreign && groupRate !== undefined
    ? tryConvertMinor(amountMinor, draft.currency, base, groupRate)
    : null;
  const rateOk = !foreign || converted !== null;
  const baseMinor = foreign ? converted ?? 0 : amountMinor;

  // The split editor shows its own arithmetic; this only needs to know
  // whether what it currently says can be saved.
  const splitOk = transfer
    || validateSplit(baseMinor, effectiveSplit, { tiebreakSeed: splitSeed(draft) }).ok;

  // Payers are checked against the amount in the entry's own currency: that is
  // the number people typed and the number they'd check against a receipt.
  const payerCheck = validatePayers(amountMinor, transfer ? null : draft.payers);

  // A side has to be somebody still in the group, not merely a non-empty
  // string: a removed member's id is truthy, so a truthiness check lights Save
  // over a transfer from somebody who has left.
  const live = new Set(input.liveMembers);
  const sidesOk = !transfer
    || (draft.fromMember !== draft.toMember && live.has(draft.fromMember) && live.has(draft.toMember));

  // Everybody an entry names must still be in the group: a member removed while
  // this was open leaves an id no picker can show — money against a name on no
  // list, or a transfer side showing "—". (docs/data-model.md)
  const goneMember = (transfer
    ? [draft.fromMember, draft.toMember]
    : [draft.paidBy, ...Object.keys(draft.payers ?? {}), ...splitParticipants(effectiveSplit)])
    .find((id) => id && !live.has(id));

  // The Receipt tab is a claim; `receiptSplit` is whether it's true. Without
  // this, saving over an even split would say "by items" about a split nobody
  // read off a receipt.
  const receiptMissing = canScan && activeTab === "receipt" && receiptSplit === null;

  // The one place the form says why Save is refused, reachable from every
  // state that refuses it. A missing rate says nothing here — there is no field;
  // its badge blooms instead (design-system.md).
  const blocker = goneMember
    ? copy.form.goneMember(nameOf(goneMember))
    : payerProblemText(payerCheck, draft.currency,
      draft.kind === "income" ? "income" : "expense");

  const amountMissing = amountMinor <= 0;
  // A transfer's words are a note and optional; an expense without a name is a
  // row nobody can identify a week later.
  const titleMissing = !transfer && draft.description.trim().length === 0;

  const ready = !amountMissing && !titleMissing && rateOk && splitOk
    && !blocker && !receiptMissing && sidesOk;

  return {
    amountMinor, baseMinor, foreign, groupRate, rateOk,
    activeTab, canScan, receiptTotal, receiptLocksAmount: receiptTotal !== null,
    onReceiptTab, activeSplit: tabSplit, receiptSplit, effectiveSplit,
    blocker, amountMissing, titleMissing, receiptMissing, ready,
  };
}
