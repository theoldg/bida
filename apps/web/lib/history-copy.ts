import {
  isValidRate, resolveSplit, splitParticipants,
  type CurrencyCode, type Id, type Member, type ReceiptItem, type Revision, type SplitSpec,
} from "@bida/core";
import { copy } from "./copy";
import { printedBill } from "./scan/items";
import { dayLabel, money, plural, rateText } from "./format";

/**
 * Which sentence the log gets for a revision (`copy.history` holds the words),
 * and the lines under it. A revision that moved several fields says the entry
 * was edited and lists them.
 *
 * It must be **total**: it runs in a render over every patch, so one throw is
 * a white screen, not a missing line.
 *
 * **Read the entity, not only the change.** `Revision.before` / `after` say
 * whether this is an income, which currency the figures are in, who the other
 * payer was.
 */

interface Described {
  what: string;
  diff?: { was?: string; now: string };
  /**
   * Every field the revision changed, a labelled line each, in place of a
   * sentence. An entry is saved whole (`editExpense`), so several at once is
   * ordinary. **Never rank the fields**: a caption of "changed who's involved"
   * over a revision that also moved the money never mentions the money.
   */
  also?: Detail[];
}

/** One field on its own line: what it is called, and what it moved between. */
interface Detail {
  label: string;
  was?: string;
  now?: string;
}

type Values = { was?: string; now: string };

/** One changed field, before it is known whether it is alone in the revision. */
interface Part {
  /** The sentence, where this is the only thing that moved. */
  what: string;
  /** The field's name, where it is one of several. */
  label: string;
  /** Under the sentence. */
  diff?: Values;
  /**
   * On the labelled line, where it reads differently: a crossing into an income
   * needs just the two words, and a photo count is in the sentence already.
   */
  line?: Values;
}

/**
 * One field moved: its sentence and diff. More than one: "edited" and an equal
 * line each.
 */
function assemble(parts: Part[], edited: string): Described {
  const [first] = parts;
  if (!first) return { what: edited };
  if (parts.length === 1) return { what: first.what, diff: first.diff };
  return { what: edited, also: parts.map((p) => ({ label: p.label, ...(p.line ?? p.diff) })) };
}

/**
 * Everybody's share of the whole, in basis points — the one reading of a split
 * that survives a change of mode ("evenly between two" is "one part each").
 * Null where nothing is allocated.
 */
function proportions(spec: SplitSpec | null | undefined): Record<Id, number> | null {
  if (!spec) return null;
  const weights: Record<Id, number> = {};
  for (const id of splitParticipants(spec)) {
    const w = spec.mode === "equal" ? 1
      : spec.mode === "shares" || spec.mode === "receipt" ? spec.weights[id] ?? 0
        : spec.mode === "exact" ? spec.amounts[id] ?? 0
          : spec.bps[id] ?? 0;
    // Exact amounts are money and the rest are counts, but as a *ratio* they
    // are the same question, so one distribution answers it for all four.
    if (Number.isSafeInteger(w) && w > 0) weights[id] = w;
  }
  try {
    return resolveSplit(10_000, { mode: "shares", weights }).shares;
  } catch {
    return null;
  }
}

/** The entity as the fold held it — loose fields, not a typed `Expense`. */
type State = Readonly<Record<string, unknown>>;

/** Live contributions, keyed in a fixed order, or null for a single payer. */
function coPayers(state: State): [Id, number][] | null {
  const spec = state["payers"];
  if (!spec || typeof spec !== "object") return null;
  const live = Object.entries(spec as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0) as [Id, number][];
  // One contributor is a single payer written the long way (`normalisePayers`
  // stores null), so nothing visible changed. Ordered by the caller, by name
  // (`inNameOrder`).
  return live.length > 1 ? live : null;
}

/**
 * Every entity kind gets a plain-English sentence and, where it helps, a diff —
 * or, where one revision moved several fields, a line for each of them.
 */
export function describe(
  rev: Revision,
  who: string,
  memberById: Map<string, Member>,
  currency: CurrencyCode,
): Described {
  const said = copy.history;
  const field = (name: string) => rev.changes.find((c) => c.field === name);
  const nameOf = (id: unknown) =>
    (typeof id === "string" ? memberById.get(id)?.name ?? copy.someoneLower : copy.someoneLower);
  /** Money, or nothing at all — a diff line is worth less than a live screen. */
  const cash = (v: unknown, code: CurrencyCode = currency) =>
    (typeof v === "number" && Number.isFinite(v) ? money(v, code) : undefined);
  /**
   * The currency of the entry's own figures (`amountMinor`, every payer's
   * contribution). Only `baseAmountMinor` is in the group's.
   */
  const ownCurrency = (state: State): CurrencyCode =>
    (typeof state["currency"] === "string" ? state["currency"] : currency);
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  /** A day the way the ledger writes it — "Today", "Sat 5 April". */
  const dayPair = (c: { before: unknown; after: unknown }) => {
    const day = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? dayLabel(v) : undefined);
    return { was: day(c.before), now: day(c.after) ?? "" };
  };
  /**
   * A split's people in printed order, by name. Ids are hashes of names
   * (ADR-0034), so id order puts a was/now pair in two unrelated orders.
   */
  const inNameOrder = (spec: SplitSpec) =>
    splitParticipants(spec)
      .map((id) => [id, memberById.get(id)?.name ?? copy.unknown] as const)
      .sort(([, a], [, b]) => a.localeCompare(b));
  const namesOf = (spec: SplitSpec | null | undefined) =>
    spec ? inNameOrder(spec).map(([, name]) => name).join(", ") : "";
  /** The payer side of a fold, ordered the same way and for the same reason. */
  const payersByName = (state: State) =>
    coPayers(state)
      ?.map(([id, amount]) => [id, nameOf(id), amount] as const)
      .sort(([, a], [, b]) => a.localeCompare(b)) ?? null;
  /**
   * What each person is down for, in the mode's words — "Evenly", "Ana ×2 ·
   * Bo ×1", "Ana €12.00 · Bo €8.00". For when only the shares changed.
   */
  const shareLine = (spec: SplitSpec | null | undefined): string => {
    if (!spec) return "";
    if (spec.mode === "equal") return copy.split.mode.equal;
    // A receipt's weights are minor units, not chosen numbers ("Teo ×3943
    // parts"); the sentence above says who had what changed.
    if (spec.mode === "receipt") return copy.split.mode.receipt;
    return inNameOrder(spec).map(([id, name]) => {
      const value = spec.mode === "shares" ? copy.history.parts(spec.weights[id] ?? 0)
        : spec.mode === "exact" ? money(spec.amounts[id] ?? 0, currency)
          : copy.history.percent((spec.bps[id] ?? 0) / 100);
      return copy.history.shareOf(name, value);
    }).join(" · ");
  };

  if (rev.entity === "expense") {
    // Only the revision that crossed between income and expense carries `kind`,
    // so read it off the fold — or every later income edit says "edited this
    // entry".
    const kind = rev.after["kind"] === "income" ? "income" : "expense";
    const noun = copy.entryKind.label[kind].toLowerCase();

    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const split = field("split")?.after as SplitSpec | undefined;
      const n = split ? splitParticipants(split).length : undefined;
      const ways = n ? plural(n, copy.noun.way) : undefined;
      const shared = kind === "income";
      return {
        what: said.createdEntry(who, noun),
        diff: amt !== undefined
          ? { now: `${amt}${ways ? ` · ${shared ? copy.group.sharedWays(ways) : copy.group.splitWays(ways)}` : ""}` }
          : undefined,
      };
    }
    if (rev.isDelete) return { what: said.deletedEntry(who, noun) };
    // Put back whole (ADR-0031): the lift is all it carries.
    if (field("deletedAt")?.after === null) return { what: said.restoredEntry(who, noun) };

    // Everything the revision moved, in screen order. Collected, since the first
    // field recognised must not be the only one mentioned.
    const parts: Part[] = [];
    const named = said.field;

    // A crossing is worth a sentence. An expense is the *absence* of `kind`, so
    // `kind: "expense"` against nothing changed nothing.
    const crossing = field("kind");
    if (crossing && (crossing.after === "income" || crossing.before === "income")) {
      const kindWord = (v: unknown) =>
        (v === "income" ? copy.entryKind.label.income : copy.entryKind.label.expense);
      parts.push({
        what: crossing.after === "income" ? said.toIncome(who) : said.toExpense(who),
        label: named.kind,
        line: { was: kindWord(crossing.before), now: kindWord(crossing.after) },
      });
    }
    const split = field("split");
    if (split) {
      const was = split.before as SplitSpec | null;
      const now = split.after as SplitSpec;
      // Who it is spent on, then how much each owes. Only the first, and moving a
      // part between names reads "changed who's involved" over the same two names.
      const wasWho = namesOf(was);
      const nowWho = namesOf(now);
      const wasHow = shareLine(was);
      const nowHow = shareLine(now);
      if (wasWho !== nowWho) {
        parts.push({
          what: said.changedInvolved(who), label: named.involved,
          diff: { was: wasWho || undefined, now: nowWho },
        });
      } else if (JSON.stringify(proportions(was)) !== JSON.stringify(proportions(now))
        && wasHow !== nowHow) {
        parts.push({
          what: said.changedShares(who), label: named.split,
          diff: { was: wasHow || undefined, now: nowHow },
        });
      }
      // Same people, same shares: the spec was rewritten and nobody's money moved.
      // The mode line below says whether it now *reads* differently.
    }
    // The scan behind the split, and the grid that assigned it. Both move
    // fields no sentence above names, so without this a save that reopened the
    // receipt and moved a salad from one person to another says nothing.
    // **Read as printed** (`printedBill`): a line split into portions is the
    // same bill, and at most a change of who had what.
    // Loose fields, so shaped before they are read: this must not throw.
    const printed = (state: State) => printedBill(
      (Array.isArray(state["receiptItems"]) ? state["receiptItems"] as unknown[] : [])
        .filter((i): i is ReceiptItem => !!i && typeof i === "object"
          && typeof (i as ReceiptItem).amount === "string" && typeof (i as ReceiptItem).label === "string"),
      (Array.isArray(state["receiptAssignments"]) ? state["receiptAssignments"] as unknown[] : [])
        .map((row) => (Array.isArray(row) ? row.filter((id): id is string => typeof id === "string") : [])),
      ownCurrency(state),
    );
    const bill = { was: printed(rev.before), now: printed(rev.after) };
    const reshaped = JSON.stringify(bill.was.lines) === JSON.stringify(bill.now.lines);
    // `receiptDiscounts` and `receiptText`, both plural-and-spelled-out. There
    // is no singular `receiptDiscount` field — ask for one and a save that only
    // moved a bill's deductions says nothing.
    if ((field("receiptItems") && !reshaped) || field("receiptTip") || field("receiptTax")
      || field("receiptDiscounts") || field("receiptText")) {
      const wasLines = bill.was.lines.length;
      const nowLines = bill.now.lines.length;
      parts.push({
        what: nowLines === 0 ? said.removedReceipt(who)
          : wasLines === 0 ? said.addedReceipt(who) : said.changedReceipt(who),
        label: named.receipt,
        diff: {
          was: wasLines ? plural(wasLines, copy.noun.item) : undefined,
          now: nowLines ? plural(nowLines, copy.noun.item) : copy.none,
        },
      });
    } else if (field("receiptInvolved")
      || (field("receiptAssignments") && JSON.stringify(bill.was.eaters) !== JSON.stringify(bill.now.eaters))) {
      parts.push({ what: said.changedWhoHadWhat(who), label: named.whoHadWhat });
    }
    // Only the amount fields that actually changed reach here: a currency switch
    // at the same rate is a currency change with no amount change. Each figure is
    // printed in its own currency — `amountMinor` is the entry's, base the group's.
    const inBase = field("baseAmountMinor");
    const amount = inBase ?? field("amountMinor");
    if (amount) {
      const code = inBase ? currency : ownCurrency(rev.after);
      parts.push({
        what: said.changedAmount(who), label: named.amount,
        diff: { was: cash(amount.before, code), now: cash(amount.after, code) ?? "" },
      });
    }
    const currencyChange = field("currency");
    if (currencyChange) {
      parts.push({
        what: said.changedCurrency(who), label: named.currency,
        diff: { was: text(currencyChange.before), now: text(currencyChange.after) ?? "" },
      });
    }
    const rate = field("rateToBase");
    if (rate) {
      parts.push({
        what: said.changedRate(who), label: named.rate,
        diff: { was: text(rate.before), now: text(rate.after) ?? "" },
      });
    }
    // The payer side asks the split's two questions again. Both are read off the
    // fold: adding a co-payer moves only `payers`, and the name they join is on
    // the entity.
    if (field("payers") ?? field("paidBy")) {
      /** Who put money in, by name: `payerList`, over a state not an `Expense`. */
      const payerNames = (state: State) => {
        const spec = payersByName(state);
        return spec ? spec.map(([, name]) => name).join(", ") : nameOf(state["paidBy"]);
      };
      /**
       * Each payer and what they put in, in the entry's currency — "Ana €40.00 ·
       * Bo €10.00" — one line answering both questions.
       */
      const payerLine = (state: State) => {
        const spec = payersByName(state);
        if (!spec) return nameOf(state["paidBy"]);
        const code = ownCurrency(state);
        return spec.map(([, name, amount]) => said.shareOf(name, money(amount, code))).join(" · ");
      };
      const wasWho = payerNames(rev.before);
      const nowWho = payerNames(rev.after);
      const wasHow = payerLine(rev.before);
      const nowHow = payerLine(rev.after);
      const diff = { was: wasHow || undefined, now: nowHow };
      if (wasWho !== nowWho) {
        parts.push({
          what: said.payerWho[kind](who),
          label: kind === "income" ? named.receiver : named.payer,
          diff,
        });
      } else if (wasHow !== nowHow) {
        parts.push({ what: said.payerHow[kind](who), label: named.putIn, diff });
      }
      // Same people, same contributions: a map normalised to the single payer
      // it already meant. Nothing moved, so nothing is said.
    }
    const description = field("description");
    if (description) {
      parts.push({
        what: said.changedDescription(who), label: named.description,
        diff: {
          was: (description.before as string) || copy.none,
          now: (description.after as string) || copy.none,
        },
      });
    }
    const when = field("occurredAt");
    if (when) parts.push({ what: said.changedDate(who), label: named.date, diff: dayPair(when) });
    // Nothing sets a category yet (it is a seam), and `describe` is handed no
    // category names to print — so this one is a label with no values under it.
    if (field("categoryId")) {
      parts.push({ what: said.changedCategory(who), label: named.category });
    }
    const photos = field("attachmentIds");
    if (photos) {
      const before = Array.isArray(photos.before) ? photos.before.length : 0;
      const after = Array.isArray(photos.after) ? photos.after.length : 0;
      parts.push({
        what: said.changedPhotos(who, after > before, plural(Math.abs(after - before), copy.noun.photo)),
        label: named.photos,
        line: { was: plural(before, copy.noun.photo), now: plural(after, copy.noun.photo) },
      });
    }
    // The last resort: the split's mode (a receipt is a mode, ADR-0016). A
    // same-meaning mode swap is dropped above, but it is the whole of some saves,
    // which would otherwise read "edited this entry" with nothing under it.
    if (parts.length === 0) {
      const modeLabel = (state: State): string => {
        const spec = state["split"] as SplitSpec | null | undefined;
        return spec?.mode ? copy.split.mode[spec.mode] ?? "" : "";
      };
      const wasMode = modeLabel(rev.before);
      const nowMode = modeLabel(rev.after);
      if (nowMode && wasMode !== nowMode) {
        parts.push({
          what: said.rewroteSplit(who), label: named.splitMode,
          diff: { was: wasMode || undefined, now: nowMode },
        });
      }
    }
    return assemble(parts, said.editedEntry(who, noun));
  }

  if (rev.entity === "identity") {
    const c = field("memberId");
    const now = nameOf(c?.after);
    // The entity id is a device, but a claim moving is one person becoming
    // another — "Teo became Seppi" needs no was/now line.
    if (rev.isCreate) return { what: said.newDevice(now) };
    return { what: said.became(nameOf(c?.before), now) };
  }

  if (rev.entity === "settlement") {
    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const between = field("fromMember") && field("toMember")
        ? `${nameOf(field("fromMember")!.after)} → ${nameOf(field("toMember")!.after)}` : undefined;
      return {
        what: said.recordedTransfer(who),
        diff: amt !== undefined ? { now: between ? `${amt} · ${between}` : amt } : undefined,
      };
    }
    if (rev.isDelete) return { what: said.deletedTransfer(who) };
    if (field("deletedAt")?.after === null) return { what: said.restoredTransfer(who) };
    // A transfer is saved whole too, so the same rule holds: one field moved
    // gets a sentence, several get a line each.
    const parts: Part[] = [];
    const named = said.field;
    const inBase = field("baseAmountMinor");
    const amount = inBase ?? field("amountMinor");
    if (amount) {
      const code = inBase ? currency : ownCurrency(rev.after);
      parts.push({
        what: said.changedAmount(who), label: named.amount,
        diff: { was: cash(amount.before, code), now: cash(amount.after, code) ?? "" },
      });
    }
    // A transfer has a currency and a rate of its own, like an entry does, and
    // a save that moved either read as "edited a transfer" and nothing else.
    const currencyChange = field("currency");
    if (currencyChange) {
      parts.push({
        what: said.changedCurrency(who), label: named.currency,
        diff: { was: text(currencyChange.before), now: text(currencyChange.after) ?? "" },
      });
    }
    const rate = field("rateToBase");
    if (rate) {
      parts.push({
        what: said.changedRate(who), label: named.rate,
        diff: { was: text(rate.before), now: text(rate.after) ?? "" },
      });
    }
    // Both sides on one line, read off the fold: a swap moves both fields, and
    // naming one says nothing.
    if (field("fromMember") ?? field("toMember")) {
      const between = (state: State) =>
        `${nameOf(state["fromMember"])} → ${nameOf(state["toMember"])}`;
      parts.push({
        what: said.changedSides(who), label: named.sides,
        diff: { was: between(rev.before), now: between(rev.after) },
      });
    }
    const note = field("note");
    if (note) {
      parts.push({
        what: said.changedNote(who), label: named.note,
        diff: { was: (note.before as string) || copy.none, now: (note.after as string) || copy.none },
      });
    }
    const when = field("occurredAt");
    if (when) parts.push({ what: said.changedDate(who), label: named.date, diff: dayPair(when) });
    return assemble(parts, said.editedTransfer(who));
  }

  if (rev.entity === "member") {
    // Named after the member the revision is *about*, not the actor: the actor
    // is whoever was holding a phone, so adding three people in a row read as
    // the same person joining three times over.
    const them = memberById.get(rev.entityId)?.name
      ?? (typeof field("name")?.after === "string" ? field("name")!.after as string : copy.someoneLower);
    // `self` on a create is somebody adding themselves on the join screen. No
    // self-delete exists: you can only be removed (docs/data-model.md).
    const self = rev.op.actor === rev.entityId;
    if (rev.isCreate) return { what: self ? said.joined(them) : said.added(who, them) };
    if (rev.isDelete) return { what: said.removed(who, them) };
    // Lifting the tombstone is the one member change nobody made: a removal
    // that raced an entry naming them is undone automatically (`healGroup`),
    // and the sentence says what the log said, not which phone noticed it.
    if (field("deletedAt")?.after === null) return { what: said.readded(them) };
    if (field("name")) {
      const c = field("name")!;
      return {
        what: self ? said.renamedSelf(who) : said.renamed(who, c.before as string),
        diff: { was: c.before as string, now: c.after as string },
      };
    }
    return { what: self ? said.updatedSelf(who) : said.updatedMember(who, them) };
  }

  // A rate is the group's, and its entity id is the currency code itself, so
  // the sentence can name the currency without looking anything up.
  if (rev.entity === "rate") {
    const code = rev.entityId;
    const pair = (v: unknown) =>
      (typeof v === "string" && isValidRate(v) ? said.ratePair(code, rateText(v), currency) : undefined);
    if (rev.isDelete) return { what: said.removedRate(who, code) };
    // The rate half of the same repair, before the `rate` field below: a lift
    // carries only `deletedAt`, and would read as "changed the MAD rate".
    if (field("deletedAt")?.after === null) return { what: said.restoredRate(code) };
    const c = field("rate");
    const now = pair(c?.after);
    if (rev.isCreate) return { what: said.setRate(who, code), diff: now ? { now } : undefined };
    if (c) return { what: said.changedRateFor(who, code), diff: { was: pair(c.before), now: now ?? "" } };
    return { what: said.changedRateFor(who, code) };
  }

  // group
  if (rev.isCreate) return { what: said.createdGroup(who) };
  if (field("name")) {
    const c = field("name")!;
    return { what: said.renamedGroup(who), diff: { was: c.before as string, now: c.after as string } };
  }
  if (field("archivedAt")) {
    return { what: field("archivedAt")!.after ? said.archivedGroup(who) : said.restoredGroup(who) };
  }
  return { what: said.updatedGroup(who) };
}
