import {
  isValidRate, resolveSplit, splitParticipants,
  type CurrencyCode, type Id, type Member, type Revision, type SplitSpec,
} from "@bida/core";
import { copy } from "./copy";
import { dayLabel, money, plural, rateText } from "./format";

/**
 * Which sentence the log gets for a revision. The sentences themselves are
 * `copy.history` — this file only decides which one applies, and what goes in
 * the lines under it. A revision that moved several fields gets no sentence
 * about any one of them: it says the entry was edited, and lists them.
 *
 * It must be **total**: it runs inside a render over every patch the log
 * holds, so one throw is a white screen, not a missing line.
 *
 * **Read the entity, not only the change.** A revision carries the fold either
 * side of it (`Revision.before` / `after`), and half of what makes a sentence
 * useful is in there rather than in the fields that moved: whether this entry
 * is an income, the currency its figures are in, who the other payer was.
 */

export interface Described {
  what: string;
  diff?: { was?: string; now: string };
  /**
   * Every field the revision changed, a labelled line each — what a revision
   * that moved more than one gets *instead* of a sentence about one of them.
   * An entry is saved whole (`editExpense`), so several at once is ordinary,
   * and a merge can revert somebody's amount in the same op that changes the
   * description. Ranking the fields is what let a permanent record caption
   * that revision "changed who's involved" and never mention the money.
   */
  also?: Detail[];
}

/** One field on its own line: what it is called, and what it moved between. */
export interface Detail {
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
   * On the labelled line, where that wants saying differently: a crossing into
   * an income is a whole sentence on its own but a line needs the two words,
   * and a count of photos is in the sentence already.
   */
  line?: Values;
}

/**
 * One field moved: it gets its sentence, and its diff under it. More than one
 * moved: no field outranks another, so the sentence says only that the entry
 * was edited and each of them gets an equal line beneath it.
 */
function assemble(parts: Part[], edited: string): Described {
  const [first] = parts;
  if (!first) return { what: edited };
  if (parts.length === 1) return { what: first.what, diff: first.diff };
  return { what: edited, also: parts.map((p) => ({ label: p.label, ...(p.line ?? p.diff) })) };
}

/**
 * Everybody's share of the whole, in basis points — the one reading of a split
 * that survives a change of mode. "Evenly between two" and "one part each" are
 * the same split written twice, and a log announcing a difference between them
 * is noise. Null where nothing is allocated at all: an empty split, or one
 * whose every part is zero.
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
  // One contributor is a single payer written the long way — `normalisePayers`
  // stores null for it, and an edit that collapses the map to one name has
  // changed nothing a person can see. The order is the caller's to set, and it
  // sets it by name — see `inNameOrder`.
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
   * The currency the entry's own figures are in — its `amountMinor`, and every
   * payer's contribution. Only `baseAmountMinor` is in the group's currency, so
   * printing everything in that one put a euro sign over a figure in dirhams.
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
   * The people of a split, in the order they are printed rather than the order
   * they are stored. `splitParticipants` sorts by id, and an id is a hash of
   * the name now (ADR-0034), so a was/now pair came out in two unrelated
   * orders — "Cy, Ana, Bruno" over "Ana, Bruno" — and the reader had to work
   * out which name had gone. Sorting by the name puts the two lines in step.
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
   * What each person is down for, in the mode's own words — "Evenly", "Ana ×2
   * · Bo ×1", "Ana €12.00 · Bo €8.00". The names are already on the line above
   * when the *people* changed; this line is for when only the shares did.
   */
  const shareLine = (spec: SplitSpec | null | undefined): string => {
    if (!spec) return "";
    if (spec.mode === "equal") return copy.split.mode.equal;
    // A receipt's weights are the bill divided up, in minor units — they are
    // nobody's chosen number, and printed as parts they read "Teo ×3943
    // parts". The line for a receipt is what it is; who had what changed is
    // the sentence above it (`changedWhoHadWhat`).
    if (spec.mode === "receipt") return copy.split.mode.receipt;
    return inNameOrder(spec).map(([id, name]) => {
      const value = spec.mode === "shares" ? copy.history.parts(spec.weights[id] ?? 0)
        : spec.mode === "exact" ? money(spec.amounts[id] ?? 0, currency)
          : copy.history.percent((spec.bps[id] ?? 0) / 100);
      return copy.history.shareOf(name, value);
    }).join(" · ");
  };

  if (rev.entity === "expense") {
    // An income and an expense are one entity, and only the revision that
    // crossed between them carries `kind` — so this is read off the fold. Every
    // later edit of an income used to be captioned "edited this entry", the one
    // noun that is never wrong and never says anything either.
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

    // Everything the revision moved, in the order the screens read it. An
    // entry is saved whole, so this is regularly several fields — collected
    // rather than returned one at a time, since the first one recognised is
    // not allowed to be the only one the log mentions.
    const parts: Part[] = [];
    const named = said.field;

    // A crossing between the two is worth a sentence; the bookkeeping isn't.
    // An expense is the *absence* of `kind` on the log, so an edit that carries
    // `kind: "expense"` against nothing changed nothing — say what else the
    // edit did instead of announcing a direction it never left.
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
      // Two questions, in the order a person cares about them: who it is
      // spent on, and then how much each of them owes. Asking only the first
      // is what put "changed who's involved" over an edit that moved a part
      // from one name to another — the same two names on both lines, and
      // nothing on screen saying what had actually moved.
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
      // Same people, same shares: the spec was rewritten — a re-picked member,
      // a mode swapped for an identical one — and nobody's money moved. The
      // mode line below says whether the entry now *reads* differently.
    }
    // The scan behind the split, and the grid that assigned it. Both move
    // fields no sentence above names, so a save that only reopened the receipt
    // and moved a salad from one person to another said nothing at all.
    const lines = (state: State) =>
      (Array.isArray(state["receiptItems"]) ? state["receiptItems"].length : 0);
    if (field("receiptItems") ?? field("receiptTip")
      ?? field("receiptTax") ?? field("receiptDiscount")) {
      const wasLines = lines(rev.before);
      const nowLines = lines(rev.after);
      parts.push({
        what: nowLines === 0 ? said.removedReceipt(who)
          : wasLines === 0 ? said.addedReceipt(who) : said.changedReceipt(who),
        label: named.receipt,
        diff: {
          was: wasLines ? plural(wasLines, copy.noun.item) : undefined,
          now: nowLines ? plural(nowLines, copy.noun.item) : copy.none,
        },
      });
    } else if (field("receiptInvolved") ?? field("receiptAssignments")) {
      parts.push({ what: said.changedWhoHadWhat(who), label: named.whoHadWhat });
    }
    // The three amount fields move together, but only the ones that actually
    // changed reach here: switching an expense to another currency at the same
    // rate leaves the figure alone, so there is a currency change and no
    // amount change to report. Say what changed rather than assuming a number
    // is there to print.
    //
    // Each figure is printed in its own currency — the base one is the group's,
    // and `amountMinor` is in the entry's, which is only ever the same currency
    // by coincidence.
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
    // The payer side asks the split's two questions over again — who put money
    // in, then how much each of them did — and answers whichever moved.
    //
    // Both are read off the fold, because neither is answered by the change
    // alone: adding a co-payer beside the largest contributor moves `payers`
    // and nothing else, and the name they join is on the entity. That is what
    // left every co-payer edit captioned "edited this entry" — and unmentioned
    // altogether where the same save moved something else.
    if (field("payers") ?? field("paidBy")) {
      /** Who put money in, by name: `payerList`, over a state not an `Expense`. */
      const payerNames = (state: State) => {
        const spec = payersByName(state);
        return spec ? spec.map(([, name]) => name).join(", ") : nameOf(state["paidBy"]);
      };
      /**
       * The same people and what each of them put in, in the entry's own
       * currency — "Ana €40.00 · Bo €10.00". It carries the names with it, so
       * one line answers both questions and neither ever repeats the other.
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
    // The last resort, and only that: what the entry screen calls this split,
    // which is its mode and nothing else — a receipt is a mode (ADR-0016), so
    // there is no second field to consult here. A mode swapped for one that
    // means the same thing is noise beside a real change and is dropped above,
    // but it is the whole of some saves — switching tab and saving — and those
    // read as "edited this entry" with nothing under them.
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
    // The entity id is a device, but nobody reads the log for devices: a claim
    // moving is one person becoming another, and the sentence says so on its
    // own — "Teo became Seppi" needs no was/now line repeating the two names
    // under it in red and green.
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
    // Both sides on one line, read off the fold: a swap moves both fields and
    // named only one of them, so the log said "Ana → Bo" over an edit whose
    // whole point was that it is now the other way round.
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
    // `self` on a create is somebody adding themselves — the one write a phone
    // makes before it has claimed anybody, on the join screen. There is no
    // matching self-delete: you cannot leave a group, only be removed
    // (docs/data-model.md), and the trash button is never on your own row.
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
    // The rate half of the same repair, and it has to come before the `rate`
    // field below: a lift carries only `deletedAt`, so without this it fell
    // through to "changed the MAD rate" — an edit nobody made, over a number
    // that did not move.
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
