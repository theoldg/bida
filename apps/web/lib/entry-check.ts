import {
  convertMinor, isValidRate, splitParticipants, validatePayers, validateSplit,
  type CurrencyCode, type Rate, type SplitSpec,
} from "@bida/core";
import {
  activeSplit, draftAmountMinor, draftReceiptSplit, draftReceiptTotal,
  splitSeed, type EntryDraft, type SplitTab,
} from "./draft";
import { copy } from "./copy";
import { payerProblemText, splitProblemText } from "./format";

/**
 * What the entry being typed is worth, and whether it may be saved: it decides
 * money, so it is a tested function rather than `const`s in a render body.
 */

interface EntryCheck {
  /** In its *own* currency. */
  amountMinor: number;
  /** 0 when it cannot be converted. */
  baseMinor: number;
  foreign: boolean;
  rate: Rate | undefined;
  rateOk: boolean;
  activeTab: SplitTab;
  canScan: boolean;
  receiptTotal: number | null;
  /**
   * Only on a real, positive derived number: a disabled *and* empty field would
   * leave a Save that never lights.
   */
  receiptLocksAmount: boolean;
  receiptSplit: SplitSpec | null;
  effectiveSplit: SplitSpec;
  blocker: string | null;
  /** The payers don't add up to the amount: their field blooms beside the line. */
  payersOff: boolean;
  splitProblem: string | null;
  /** A field, not a sentence. */
  amountMissing: boolean;
  titleMissing: boolean;
  /** Said in words only after a refused Save. */
  receiptMissing: boolean;
  ready: boolean;
}

function tryConvertMinor(
  minor: number, from: string, to: string, rate: Rate,
): number | null {
  try {
    return convertMinor(minor, from, to, rate);
  } catch {
    return null;
  }
}

export function checkEntry(input: {
  draft: EntryDraft;
  base: CurrencyCode;
  /** A removed member is not a valid side. */
  liveMembers: readonly string[];
  nameOf: (id: string) => string;
}): EntryCheck {
  const { draft, base, nameOf } = input;
  const kind = draft.kind;
  const transfer = kind === "transfer";
  const activeTab = draft.splitTab;

  const canScan = kind === "expense";

  // Derived where it is read, never cached into the draft (ADR-0016).
  const receiptTotal = draftReceiptTotal(draft);
  const receiptSplit = draftReceiptSplit(draft);
  const effectiveSplit = activeSplit(draft);

  const amountMinor = draftAmountMinor(draft);

  const foreign = draft.currency !== base;
  // Undefined means unknown; defaulting to `"1"` banks a 500 MAD dinner as €500.
  const rate = !foreign ? "1"
    : draft.rateCurrency === draft.currency && draft.rate !== undefined && isValidRate(draft.rate)
      ? draft.rate : undefined;
  // An amount and a rate can each be in range and still multiply out of it.
  const converted = foreign && rate !== undefined
    ? tryConvertMinor(amountMinor, draft.currency, base, rate)
    : null;
  const rateOk = !foreign || converted !== null;
  const baseMinor = foreign ? converted ?? 0 : amountMinor;

  const splitOk = transfer
    || validateSplit(effectiveSplit.mode === "exact" ? amountMinor : baseMinor, effectiveSplit,
      { tiebreakSeed: splitSeed(draft) }).ok;

  // The number people typed and would check against a receipt.
  const payerCheck = validatePayers(amountMinor, transfer ? null : draft.payers);

  // A removed member's id is truthy, so a truthiness check lights Save.
  const live = new Set(input.liveMembers);
  const sidesOk = !transfer
    || (draft.fromMember !== draft.toMember && live.has(draft.fromMember) && live.has(draft.toMember));

  // The Receipt tab is a claim; `receiptSplit` is whether it's true.
  const receiptMissing = canScan && activeTab === "receipt" && receiptSplit === null;

  // Everybody an entry names must still be in the group (docs/data-model.md).
  const goneMember = (transfer
    ? [draft.fromMember, draft.toMember]
    : [draft.paidBy, ...Object.keys(draft.payers ?? {}),
      ...(receiptMissing ? [] : splitParticipants(effectiveSplit))])
    .find((id) => id && !live.has(id));

  const splitProblem = transfer || receiptMissing ? null
    : splitProblemText(validateSplit(amountMinor, effectiveSplit, { tiebreakSeed: splitSeed(draft) }),
      draft.currency, nameOf);

  // Said unasked. A missing rate blooms its badge instead.
  // On the form the line has to say whose figures are off: the bill moving
  // under a typed table of payers reads as the bill's own problem otherwise.
  const payerProblem = payerProblemText(payerCheck, draft.currency,
    draft.kind === "income" ? "income" : "expense");
  // The bill moved under a typed table: the table is what to fix, so it blooms too.
  const payersOff = !goneMember && !payerCheck.ok;
  const blocker = goneMember
    ? copy.form.goneMember(nameOf(goneMember))
    : payerProblem && !payerCheck.ok && payerCheck.problem !== "empty"
      ? copy.form.offBy(copy.entryKind.payer[draft.kind], payerProblem)
      : payerProblem;

  const amountMissing = amountMinor <= 0;
  // An expense without a name is a row nobody can identify a week later.
  const titleMissing = !transfer && draft.description.trim().length === 0;

  const ready = !amountMissing && !titleMissing && rateOk && splitOk
    && !blocker && !receiptMissing && sidesOk;

  return {
    amountMinor, baseMinor, foreign, rate, rateOk,
    activeTab, canScan, receiptTotal, receiptLocksAmount: receiptTotal !== null,
    receiptSplit, effectiveSplit,
    blocker, payersOff, splitProblem, amountMissing, titleMissing, receiptMissing, ready,
  };
}

/**
 * **Least obvious first**: an empty field going red says "fill me", a red `@ ?`
 * chip says nothing a person can act on — so the words go there.
 */
export const REFUSAL_ORDER = ["rate", "blocker", "split", "receipt", "amount", "title"] as const;
export type Refusable = (typeof REFUSAL_ORDER)[number];

/**
 * A missing field or step is said only once a Save has been refused, or a blank
 * form would open scolding.
 */
export function dockLine(missing: Record<Refusable, boolean>, told: boolean): Refusable | null {
  return REFUSAL_ORDER.find((k) => missing[k] && (told || k === "blocker" || k === "split")) ?? null;
}
