import {
  splitParticipants,
  type CurrencyCode, type Member, type Revision, type SplitSpec,
} from "@hajsik/core";
import { dayLabel, money, plural } from "./format";

/**
 * Plain English for the op log: one sentence per revision, and one label and
 * one rendered value per changed field.
 *
 * Lives here rather than in the history screen because the restore screen has
 * to say the same things about the same revision — "you are putting the amount
 * back to €48,00" is the whole content of that confirmation, and two copies of
 * this vocabulary would drift within a week.
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
  const namesOf = (spec: SplitSpec | null | undefined) =>
    spec ? splitParticipants(spec).map((id) => memberById.get(id)?.name ?? "?").join(", ") : "";

  if (rev.entity === "expense") {
    if (rev.isCreate) {
      const amt = field("baseAmountMinor")?.after as number | undefined;
      const split = field("split")?.after as SplitSpec | undefined;
      const n = split ? splitParticipants(split).length : undefined;
      return {
        what: `${who} created this expense`,
        diff: amt !== undefined
          ? { now: `${money(amt, currency)}${n ? ` · split ${plural(n, "way")}` : ""}` }
          : undefined,
      };
    }
    if (rev.isDelete) return { what: `${who} deleted this expense` };
    if (field("split")) {
      const c = field("split")!;
      return {
        what: `${who} changed who's involved`,
        diff: { was: namesOf(c.before as SplitSpec | null), now: namesOf(c.after as SplitSpec) },
      };
    }
    if (field("amountMinor") || field("currency") || field("rateToBase") || field("baseAmountMinor")) {
      const c = field("baseAmountMinor") ?? field("amountMinor")!;
      return {
        what: `${who} changed the amount`,
        diff: {
          was: typeof c.before === "number" ? money(c.before, currency) : undefined,
          now: typeof c.after === "number" ? money(c.after, currency) : "",
        },
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
    return { what: `${who} edited this expense` };
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
      const amt = field("baseAmountMinor")?.after as number | undefined;
      return { what: `${who} recorded a settlement`, diff: amt !== undefined ? { now: money(amt, currency) } : undefined };
    }
    if (rev.isDelete) return { what: `${who} deleted a settlement` };
    return { what: `${who} edited a settlement` };
  }

  if (rev.entity === "member") {
    if (rev.isCreate) return { what: `${who} joined the group` };
    if (rev.isDelete) return { what: `${who} left the group` };
    if (field("name")) {
      const c = field("name")!;
      return { what: `${who} changed their name`, diff: { was: c.before as string, now: c.after as string } };
    }
    return { what: `${who} was updated` };
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

/** What a changed field is called, in a sentence about it. */
export const FIELD_LABELS: Record<string, string> = {
  amountMinor: "the amount", currency: "the currency", rateToBase: "the rate",
  baseAmountMinor: "the amount", split: "who's involved", paidBy: "who paid",
  payers: "who chipped in",
  description: "the description", occurredAt: "the date", categoryId: "the category",
  attachmentIds: "the photos", name: "the name", archivedAt: "the archived status",
  memberId: "who a device speaks for",
  deletedAt: "whether this was deleted",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * A field's value as a person would read it. Deliberately total: a patch can
 * carry anything an older version of the app wrote, and a restore screen that
 * throws on one odd field is worse than one that prints it raw.
 */
export function fieldValue(
  field: string,
  value: unknown,
  ctx: { memberById: Map<string, Member>; currency: CurrencyCode },
): string {
  const nameOf = (id: unknown) =>
    typeof id === "string" ? ctx.memberById.get(id)?.name ?? "someone" : "someone";

  if (value === null || value === undefined) {
    return field === "deletedAt" ? "not deleted" : "nothing";
  }
  if (field === "deletedAt") return "deleted";
  if (field === "baseAmountMinor" || field === "amountMinor") {
    return typeof value === "number" ? money(value, ctx.currency) : String(value);
  }
  if (field === "occurredAt") return typeof value === "number" ? dayLabel(value) : String(value);
  if (field === "paidBy") return nameOf(value);
  if (field === "split") {
    const names = splitParticipants(value as SplitSpec).map(nameOf);
    return names.length > 0 ? names.join(", ") : "nobody";
  }
  if (field === "payers" && typeof value === "object") {
    return Object.keys(value as Record<string, number>).map(nameOf).join(", ") || "nobody";
  }
  if (field === "attachmentIds") {
    return Array.isArray(value) ? `${value.length}` : String(value);
  }
  if (typeof value === "string") return value || "nothing";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
