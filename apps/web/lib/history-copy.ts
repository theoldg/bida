import {
  formatRate, isValidRate, resolveSplit, splitParticipants,
  type CurrencyCode, type Id, type Member, type Revision, type SplitSpec,
} from "@hajsik/core";
import { copy } from "./copy";
import { money, plural } from "./format";

/**
 * Which sentence the log gets for a revision. The sentences themselves are
 * `copy.history` — this file only decides which one applies, and what goes in
 * the diff line under it.
 *
 * It must be **total**: it runs inside a render over every patch the log
 * holds, so one throw is a white screen, not a missing line.
 */

export interface Described {
  what: string;
  diff?: { was?: string; now: string };
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
      : spec.mode === "shares" ? spec.weights[id] ?? 0
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

/** Every entity kind gets a plain-English sentence and, where it helps, a diff. */
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
  const cash = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? money(v, currency) : undefined);
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const namesOf = (spec: SplitSpec | null | undefined) =>
    spec ? splitParticipants(spec).map((id) => memberById.get(id)?.name ?? copy.unknown).join(", ") : "";
  /**
   * What each person is down for, in the mode's own words — "Evenly", "Ana ×2
   * · Bo ×1", "Ana €12.00 · Bo €8.00". The names are already on the line above
   * when the *people* changed; this line is for when only the shares did.
   */
  const shareLine = (spec: SplitSpec | null | undefined): string => {
    if (!spec) return "";
    if (spec.mode === "equal") return copy.split.mode.equal;
    const name = (id: Id) => memberById.get(id)?.name ?? copy.unknown;
    return splitParticipants(spec).map((id) => {
      const value = spec.mode === "shares" ? copy.history.parts(spec.weights[id] ?? 0)
        : spec.mode === "exact" ? money(spec.amounts[id] ?? 0, currency)
          : copy.history.percent((spec.bps[id] ?? 0) / 100);
      return copy.history.shareOf(name(id), value);
    }).join(" · ");
  };

  if (rev.entity === "expense") {
    // An income and an expense are one entity, so a revision only knows which
    // it is when the op itself carried `kind`. Where it didn't, the sentence
    // says "entry" rather than guessing — a wrong noun in the log is worse
    // than a general one.
    const noun = (() => {
      const k = field("kind");
      const label = copy.entryKind.label;
      if (k) return (k.after === "income" ? label.income : label.expense).toLowerCase();
      return rev.isCreate ? label.expense.toLowerCase() : copy.noun.entry.one;
    })();

    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const split = field("split")?.after as SplitSpec | undefined;
      const n = split ? splitParticipants(split).length : undefined;
      const ways = n ? plural(n, copy.noun.way) : undefined;
      const shared = noun === copy.entryKind.label.income.toLowerCase();
      return {
        what: said.createdEntry(who, noun),
        diff: amt !== undefined
          ? { now: `${amt}${ways ? ` · ${shared ? copy.group.sharedWays(ways) : copy.group.splitWays(ways)}` : ""}` }
          : undefined,
      };
    }
    if (rev.isDelete) return { what: said.deletedEntry(who, noun) };
    // A crossing between the two is worth a sentence; the bookkeeping isn't.
    // An expense is the *absence* of `kind` on the log, so an edit that carries
    // `kind: "expense"` against nothing changed nothing — say what else the
    // edit did instead of announcing a direction it never left.
    const crossing = field("kind");
    if (crossing && (crossing.after === "income" || crossing.before === "income")) {
      return { what: crossing.after === "income" ? said.toIncome(who) : said.toExpense(who) };
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
      if (wasWho !== nowWho) {
        return { what: said.changedInvolved(who), diff: { was: wasWho || undefined, now: nowWho } };
      }
      const wasHow = shareLine(was);
      const nowHow = shareLine(now);
      if (JSON.stringify(proportions(was)) !== JSON.stringify(proportions(now)) && wasHow !== nowHow) {
        return { what: said.changedShares(who), diff: { was: wasHow || undefined, now: nowHow } };
      }
      // Same people, same shares: the spec was rewritten — a mode swapped for
      // an identical one, a re-picked member — and there is nothing to report.
      // Say what else the edit did instead of inventing a change.
    }
    // The three amount fields move together, but only the ones that actually
    // changed reach here: switching an expense to another currency at the same
    // rate leaves the figure alone, so there is a currency change and no
    // amount change to report. Say what changed rather than assuming a number
    // is there to print.
    const amount = field("baseAmountMinor") ?? field("amountMinor");
    if (amount) {
      return { what: said.changedAmount(who), diff: { was: cash(amount.before), now: cash(amount.after) ?? "" } };
    }
    if (field("currency")) {
      const c = field("currency")!;
      return { what: said.changedCurrency(who), diff: { was: text(c.before), now: text(c.after) ?? "" } };
    }
    if (field("rateToBase")) {
      const c = field("rateToBase")!;
      return { what: said.changedRate(who), diff: { was: text(c.before), now: text(c.after) ?? "" } };
    }
    if (field("paidBy")) {
      const c = field("paidBy")!;
      return { what: said.changedPayer(who), diff: { was: nameOf(c.before), now: nameOf(c.after) } };
    }
    if (field("description")) {
      const c = field("description")!;
      return {
        what: said.changedDescription(who),
        diff: { was: (c.before as string) || copy.none, now: (c.after as string) || copy.none },
      };
    }
    if (field("occurredAt")) return { what: said.changedDate(who) };
    if (field("categoryId")) return { what: said.changedCategory(who) };
    if (field("attachmentIds")) {
      const c = field("attachmentIds")!;
      const before = Array.isArray(c.before) ? c.before.length : 0;
      const after = Array.isArray(c.after) ? c.after.length : 0;
      return { what: said.changedPhotos(who, after > before, plural(Math.abs(after - before), copy.noun.photo)) };
    }
    return { what: said.editedEntry(who, noun) };
  }

  if (rev.entity === "identity") {
    const c = field("memberId");
    const now = nameOf(c?.after);
    // The entity id is a device, not a person: "who" is whoever was speaking
    // for that device a moment ago, and "now" is who it speaks for next.
    if (rev.isCreate) return { what: said.newDevice(now) };
    return { what: said.handedOver(who, now), diff: { was: nameOf(c?.before), now } };
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
    const amount = field("baseAmountMinor") ?? field("amountMinor");
    if (amount) {
      return { what: said.changedAmount(who), diff: { was: cash(amount.before), now: cash(amount.after) ?? "" } };
    }
    if (field("fromMember") || field("toMember")) {
      const c = field("fromMember") ?? field("toMember")!;
      return { what: said.changedSides(who), diff: { was: nameOf(c.before), now: nameOf(c.after) } };
    }
    if (field("note")) {
      const c = field("note")!;
      return {
        what: said.changedNote(who),
        diff: { was: (c.before as string) || copy.none, now: (c.after as string) || copy.none },
      };
    }
    if (field("occurredAt")) return { what: said.changedDate(who) };
    return { what: said.editedTransfer(who) };
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
    // that raced an entry naming them is undone automatically
    // (`readdStrandedMembers`), and the sentence says what the log said, not
    // which phone noticed it.
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
      (typeof v === "string" && isValidRate(v) ? said.ratePair(code, formatRate(v), currency) : undefined);
    if (rev.isDelete) return { what: said.removedRate(who, code) };
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
