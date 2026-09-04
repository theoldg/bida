import {
  formatRate, isValidRate, splitParticipants,
  type CurrencyCode, type Member, type Revision, type SplitSpec,
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
    if (field("split")) {
      const c = field("split")!;
      return {
        what: said.changedInvolved(who),
        diff: { was: namesOf(c.before as SplitSpec | null), now: namesOf(c.after as SplitSpec) },
      };
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
    const self = rev.op.actor === rev.entityId;
    if (rev.isCreate) return { what: self ? said.joined(them) : said.added(who, them) };
    if (rev.isDelete) return { what: self ? said.left(them) : said.removed(who, them) };
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
