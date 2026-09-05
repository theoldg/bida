import {
  convertMinor, rateFor, splitParticipants, validatePayers, validateSplit,
  type CurrencyCode, type ExchangeRate, type Rate, type SplitSpec,
} from "@hajsik/core";
import {
  activeSplit, activeSplitTab, draftAmountMinor, draftReceiptSplit, draftReceiptTotal,
  type EntryDraft, type SplitTab,
} from "./draft";
import { copy } from "./copy";
import { payerProblemText } from "./format";

/**
 * What the entry being typed is worth, and whether it may be saved.
 *
 * This is the arithmetic behind one grey button. It lived in the form's render
 * body as ten `const`s that each read two of the others, which is why it had
 * no tests: there was no way to ask it a question without mounting a screen.
 * It decides money — an amount, a rate, a split and a base figure — so per
 * [CLAUDE.md](../../../CLAUDE.md) it is a function with a table of cases
 * behind it instead.
 *
 * Nothing here writes. The form patches the draft; this only ever reads one.
 */

export interface EntryCheck {
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
   * Whether the amount field is the receipt's to fill. Locked on a real,
   * positive derived number, never merely on having items: a field that is
   * disabled *and* empty is a screen with nothing to type in and a Save that
   * will never light.
   */
  receiptLocksAmount: boolean;
  /** True while Receipt mode is showing a bill it actually has. */
  onReceiptTab: boolean;
  /** What the tab now showing holds — the rows the split editor draws. */
  activeSplit: SplitSpec;
  /**
   * The split the receipt has read off its own bill, or null until the
   * who-had-what grid says who had what. Receipt's answer never touches the
   * three arithmetic tabs, which keep theirs (`SplitInputs`).
   */
  receiptSplit: SplitSpec | null;
  /** The split that would be saved: the receipt's where it has one, else the tab's. */
  effectiveSplit: SplitSpec;
  /** The one sentence saying why Save is grey, or null when nothing is wrong. */
  blocker: string | null;
  /**
   * Why Receipt mode hasn't produced the split it claims, or null. Kept apart
   * from `blocker` because it is read somewhere else: a complaint about the
   * split belongs in the split editor's own footer, beside "enter an amount to
   * split", not up against Save with the payer problems.
   */
  receiptBlocker: string | null;
  /** Whether Save may light. */
  ready: boolean;
}

/** `convertMinor`, or null when the product doesn't fit in a safe integer. */
export function tryConvertMinor(
  minor: number, from: string, to: string, rate: Rate,
): number | null {
  try {
    return convertMinor(minor, from, to, rate);
  } catch {
    return null;
  }
}

/**
 * True when the group has no rate for this currency — the state in which an
 * entry cannot honestly be converted, and the one that opens the rate dialog.
 * Separate from `checkEntry` because the scan handler asks it before there is
 * a draft to check: a photographed Moroccan receipt sets MAD, and the rate has
 * to be asked for on the spot.
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

  // Receipt's total is `lib/draft.ts`'s to derive, at the one place it is read
  // — never written into the draft as a cache for some other effect to notice
  // and resync. Nothing can fall out of step because nothing is recorded
  // twice (ADR-0016).
  const receiptTotal = draftReceiptTotal(draft);
  // Null until "who had what" has actually been visited (or on an old draft
  // with nothing assigned yet) — the arithmetic tab behind it is what a save
  // would then write, and `receiptBlocker` is what refuses to.
  const receiptSplit = draftReceiptSplit(draft);
  const tabSplit = activeSplit(draft);
  const effectiveSplit = receiptSplit ?? tabSplit;

  // The same question the payers editor asks, answered by the same function.
  const amountMinor = draftAmountMinor(draft);

  const foreign = draft.currency !== base;
  // The rate is the group's, read from the registry — not a field on the form
  // and not a number frozen onto the entry (ADR-0005). Undefined means the
  // group has never said what this currency is worth, which is the state that
  // used to be silently `"1"` and bank a 500 MAD dinner as €500.
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
    || validateSplit(baseMinor, effectiveSplit, { tiebreakSeed: draft.entryId ?? "new" }).ok;

  // Payers are checked against the amount in the entry's own currency: that is
  // the number people typed and the number they'd check against a receipt.
  const payerCheck = validatePayers(amountMinor, transfer ? null : draft.payers);

  // A side has to be somebody still in the group, not merely a non-empty
  // string. This checked truthiness, and a removed member's id is truthy — so
  // a settle-up row naming somebody who had left opened a transfer *from* a
  // person who is not in the group, with Save lit up.
  const live = new Set(input.liveMembers);
  const sidesOk = !transfer
    || (draft.fromMember !== draft.toMember && live.has(draft.fromMember) && live.has(draft.toMember));

  // Everybody an entry names has to still be in the group. `paidBy`, the payer
  // map and the split are all lists of ids, and a member removed while this
  // entry was open leaves one behind that no picker on either screen can show
  // — money sitting against a name that is on no list.
  //
  // A transfer's two sides are the same fault wearing "—": a removal that
  // lands while this form is open leaves a side naming somebody no picker
  // offers, and Save used to be grey over an empty slot with nothing on screen
  // saying whose name was missing. The settle-up row is no longer a way in —
  // a removal the group goes on contradicting is undone rather than settled
  // around (docs/data-model.md).
  const goneMember = (transfer
    ? [draft.fromMember, draft.toMember]
    : [draft.paidBy, ...Object.keys(draft.payers ?? {}), ...splitParticipants(effectiveSplit)])
    .find((id) => id && !live.has(id));

  // Receipt mode has to have produced the split it claims. Without this the
  // tab could be opened over an ordinary even split and saved — the entry then
  // said "from receipt" beside a split nobody read off a receipt, and a scan
  // whose grid was never filled in silently went out evenly. The tab is the
  // claim; `receiptSplit` is whether it is true.
  const receiptBlocker = canScan && activeTab === "receipt" && receiptSplit === null
    ? (hasReceiptItems ? copy.split.noWhoHadWhat : copy.split.noReceipt)
    : null;

  // The one place the form says why Save is grey. It used to live inside the
  // co-payer card, so the states that render the *single*-payer field — an
  // empty payer map, a payer who has left — held Save with nothing anywhere on
  // screen to read. A check with no visible reason is a dead end.
  const blocker = goneMember
    ? copy.form.goneMember(nameOf(goneMember))
    // A rate the group hasn't got is not a typo to be fixed in this field —
    // there is no field. Say what is missing and where it is set.
    : foreign && groupRate === undefined ? copy.rates.needed(draft.currency)
      : payerProblemText(payerCheck, draft.currency);

  const ready = amountMinor > 0 && rateOk && splitOk && !blocker && !receiptBlocker && sidesOk
    // A transfer's words are a note and optional; an expense without a name is
    // a row nobody can identify a week later.
    && (transfer || draft.description.trim().length > 0);

  return {
    amountMinor, baseMinor, foreign, groupRate, rateOk,
    activeTab, canScan, receiptTotal, receiptLocksAmount: receiptTotal !== null,
    onReceiptTab, activeSplit: tabSplit, receiptSplit, effectiveSplit,
    blocker, receiptBlocker, ready,
  };
}
