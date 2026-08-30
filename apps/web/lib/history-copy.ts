import {
  splitParticipants,
  type CurrencyCode, type Member, type Revision, type SplitSpec,
} from "@hajsik/core";
import { dayLabel, money, plural } from "./format";

/**
 * Plain English for the op log: one sentence per revision, and — where it
 * helps — what the field it changed said before and after.
 *
 * Its own file rather than the history screen's, because it is the app's
 * vocabulary for the log and nothing else on that screen is.
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
  const field = (name: string) => rev.changes.find((c) => c.field === name);
  const nameOf = (id: unknown) => (typeof id === "string" ? memberById.get(id)?.name ?? "someone" : "someone");
  /** Money, or nothing at all — a diff line is worth less than a live screen. */
  const cash = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? money(v, currency) : undefined);
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const namesOf = (spec: SplitSpec | null | undefined) =>
    spec ? splitParticipants(spec).map((id) => memberById.get(id)?.name ?? "?").join(", ") : "";

  if (rev.entity === "expense") {
    // An income and an expense are one entity, so a revision only knows which
    // it is when the op itself carried `kind`. Where it didn't, the sentence
    // says "entry" rather than guessing — a wrong noun in the log is worse
    // than a general one.
    const noun = (() => {
      const k = field("kind");
      if (k) return k.after === "income" ? "income" : "expense";
      return rev.isCreate ? "expense" : "entry";
    })();

    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const split = field("split")?.after as SplitSpec | undefined;
      const n = split ? splitParticipants(split).length : undefined;
      return {
        what: `${who} created this ${noun}`,
        diff: amt !== undefined
          ? { now: `${amt}${n ? ` · ${noun === "income" ? "shared" : "split"} ${plural(n, "way")}` : ""}` }
          : undefined,
      };
    }
    if (rev.isDelete) return { what: `${who} deleted this ${noun}` };
    // A crossing between the two is worth a sentence; the bookkeeping isn't.
    // An expense is the *absence* of `kind` on the log, so an edit that carries
    // `kind: "expense"` against nothing changed nothing — say what else the
    // edit did instead of announcing a direction it never left.
    const crossing = field("kind");
    if (crossing && (crossing.after === "income" || crossing.before === "income")) {
      return {
        what: crossing.after === "income"
          ? `${who} turned this into an income`
          : `${who} turned this back into an expense`,
      };
    }
    if (field("split")) {
      const c = field("split")!;
      return {
        what: `${who} changed who's involved`,
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
      return {
        what: `${who} changed the amount`,
        diff: { was: cash(amount.before), now: cash(amount.after) ?? "" },
      };
    }
    if (field("currency")) {
      const c = field("currency")!;
      return {
        what: `${who} changed the currency`,
        diff: { was: text(c.before), now: text(c.after) ?? "" },
      };
    }
    if (field("rateToBase")) {
      const c = field("rateToBase")!;
      return {
        what: `${who} changed the rate`,
        diff: { was: text(c.before), now: text(c.after) ?? "" },
      };
    }
    if (field("paidBy")) {
      const c = field("paidBy")!;
      return { what: `${who} changed who paid`, diff: { was: nameOf(c.before), now: nameOf(c.after) } };
    }
    if (field("description")) {
      const c = field("description")!;
      return {
        what: `${who} changed the description`,
        diff: { was: (c.before as string) || "—", now: (c.after as string) || "—" },
      };
    }
    if (field("occurredAt")) return { what: `${who} changed the date` };
    if (field("categoryId")) return { what: `${who} changed the category` };
    if (field("attachmentIds")) {
      const c = field("attachmentIds")!;
      const before = Array.isArray(c.before) ? c.before.length : 0;
      const after = Array.isArray(c.after) ? c.after.length : 0;
      return { what: `${who} ${after > before ? "added" : "removed"} ${plural(Math.abs(after - before), "photo")}` };
    }
    return { what: `${who} edited this ${noun}` };
  }

  if (rev.entity === "identity") {
    const c = field("memberId");
    const now = nameOf(c?.after);
    // The entity id is a device, not a person: "who" is whoever was speaking
    // for that device a moment ago, and "now" is who it speaks for next.
    if (rev.isCreate) return { what: `${now} started editing from a new device` };
    return {
      what: `${who} handed a device over to ${now}`,
      diff: { was: nameOf(c?.before), now },
    };
  }

  if (rev.entity === "settlement") {
    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const between = field("fromMember") && field("toMember")
        ? `${nameOf(field("fromMember")!.after)} → ${nameOf(field("toMember")!.after)}` : undefined;
      return {
        what: `${who} recorded a transfer`,
        diff: amt !== undefined ? { now: between ? `${amt} · ${between}` : amt } : undefined,
      };
    }
    if (rev.isDelete) return { what: `${who} deleted a transfer` };
    const amount = field("baseAmountMinor") ?? field("amountMinor");
    if (amount) {
      return {
        what: `${who} changed the amount`,
        diff: { was: cash(amount.before), now: cash(amount.after) ?? "" },
      };
    }
    if (field("fromMember") || field("toMember")) {
      const c = field("fromMember") ?? field("toMember")!;
      return {
        what: `${who} changed who it was between`,
        diff: { was: nameOf(c.before), now: nameOf(c.after) },
      };
    }
    if (field("note")) {
      const c = field("note")!;
      return {
        what: `${who} changed the note`,
        diff: { was: (c.before as string) || "—", now: (c.after as string) || "—" },
      };
    }
    if (field("occurredAt")) return { what: `${who} changed the date` };
    return { what: `${who} edited a transfer` };
  }

  if (rev.entity === "member") {
    // Named after the member the revision is *about*, not the actor: the actor
    // is whoever was holding a phone, so adding three people in a row read as
    // the same person joining three times over.
    const them = memberById.get(rev.entityId)?.name
      ?? (typeof field("name")?.after === "string" ? field("name")!.after as string : "someone");
    const self = rev.op.actor === rev.entityId;
    if (rev.isCreate) return { what: self ? `${them} joined the group` : `${who} added ${them}` };
    if (rev.isDelete) return { what: self ? `${them} left the group` : `${who} removed ${them}` };
    if (field("name")) {
      const c = field("name")!;
      return {
        what: self ? `${who} changed their name` : `${who} renamed ${c.before as string}`,
        diff: { was: c.before as string, now: c.after as string },
      };
    }
    return { what: `${who} updated ${self ? "their own details" : them}` };
  }

  // group
  if (rev.isCreate) return { what: `${who} created the group` };
  if (field("name")) {
    const c = field("name")!;
    return { what: `${who} renamed the group`, diff: { was: c.before as string, now: c.after as string } };
  }
  if (field("archivedAt")) {
    return { what: field("archivedAt")!.after ? `${who} archived the group` : `${who} restored the group` };
  }
  return { what: `${who} updated the group` };
}
