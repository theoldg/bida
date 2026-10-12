import {
  isValidRate, resolveEntrySplit, resolveSplit, splitParticipants,
  type CurrencyCode, type Id, type ImportSource, type Member, type ReceiptItem, type Revision, type SplitSpec,
} from "@bida/core";
import { copy } from "./copy";
import { printedBill } from "./scan/items";
import { bare, dayLabel, money, plural, rateText } from "./format";
import {
  billRows, chargeRow, eatersRow, moves, netLine, peopleText, typical, type BillLine, type People, type Row,
} from "./history-rows";

/**
 * Which sentence the log gets for a revision, and the lines under it. It must be
 * **total**: it runs in a render over every patch, so one throw is a white
 * screen. Say what moved, not both whole states — "− Cy", not two lists of eight.
 */

export interface Described {
  what: string;
  diff?: { was?: string; now: string };
  rows?: Row[];
  /**
   * Every field the revision changed, a line each. **Never rank the fields**: a
   * caption naming one change hides the money that also moved.
   */
  also?: Detail[];
}

export interface Detail {
  label: string;
  was?: string;
  now?: string;
  rows?: Row[];
}

type Values = { was?: string; now: string };

interface Part {
  what: string;
  label: string;
  diff?: Values;
  /** Where it reads differently on the labelled line. */
  line?: Values;
  rows?: Row[];
}

function assemble(parts: Part[], edited: string): Described {
  const [first] = parts;
  if (!first) return { what: edited };
  if (parts.length === 1) return { what: first.what, diff: first.diff, rows: first.rows };
  return {
    what: edited,
    also: parts.map((p) => ({ label: p.label, ...(p.line ?? p.diff), ...(p.rows ? { rows: p.rows } : {}) })),
  };
}

/**
 * Everybody's share of the whole, in basis points: whether a split *means*
 * something else, whatever the amount did.
 */
function proportions(spec: SplitSpec | null | undefined): string {
  if (!spec) return "";
  const weights: Record<Id, number> = {};
  try {
    for (const id of splitParticipants(spec)) {
      const w = spec.mode === "equal" ? 1
        : spec.mode === "shares" || spec.mode === "receipt" ? spec.weights[id] ?? 0
          : spec.amounts[id] ?? 0;
      if (Number.isSafeInteger(w) && w > 0) weights[id] = w;
    }
    return JSON.stringify(resolveSplit(10_000, { mode: "shares", weights }).shares);
  } catch {
    return "";
  }
}

type State = Readonly<Record<string, unknown>>;

function coPayers(state: State): [Id, number][] | null {
  const spec = state["payers"];
  if (!spec || typeof spec !== "object") return null;
  const live = Object.entries(spec as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0) as [Id, number][];
  // One contributor is a single payer written the long way.
  return live.length > 1 ? live : null;
}

const HEALED_RATE_FIELDS = new Set(["rateToBase", "baseAmountMinor", "rateSource"]);

export function describe(
  rev: Revision,
  who: string,
  memberById: Map<string, Member>,
  currency: CurrencyCode,
  source?: ImportSource | null,
): Described {
  const said = copy.history;
  const from = source ? said.importSource[source] : undefined;
  const field = (name: string) => rev.changes.find((c) => c.field === name);
  const nameOf = (id: unknown) =>
    (typeof id === "string" ? memberById.get(id)?.name ?? copy.someoneLower : copy.someoneLower);
  /** A diff line is worth less than a live screen. */
  const cash = (v: unknown, code: CurrencyCode = currency) =>
    (typeof v === "number" && Number.isFinite(v) ? money(v, code) : undefined);
  /** Only `baseAmountMinor` is in the group's. */
  const ownCurrency = (state: State): CurrencyCode =>
    (typeof state["currency"] === "string" ? state["currency"] : currency);
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const dayPair = (c: { before: unknown; after: unknown }) => {
    const day = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? dayLabel(v) : undefined);
    return { was: day(c.before), now: day(c.after) ?? "" };
  };
  const people: People = { nameOf, roster: rev.roster ?? [] };
  /** The group's own currency goes bare; anything else keeps its code. */
  const fig = (minor: number, code: CurrencyCode) => (code === currency ? bare(minor, code) : money(minor, code));
  /**
   * What each person owes, in the group's currency — the one reading that
   * survives a change of mode. An even split's spare cents are laid flat.
   */
  const sharesOf = (state: State): Map<Id, number> | null => {
    const split = state["split"] as SplitSpec | null | undefined;
    const amountMinor = state["amountMinor"];
    const baseAmountMinor = state["baseAmountMinor"];
    if (!split || typeof split !== "object" || typeof amountMinor !== "number"
      || typeof baseAmountMinor !== "number") return null;
    try {
      const { shares } = resolveEntrySplit({ id: rev.entityId, amountMinor, baseAmountMinor, split });
      const out = new Map(Object.entries(shares));
      const flat = split.mode === "equal" ? typical(out.values()) : undefined;
      if (flat !== undefined) for (const id of out.keys()) out.set(id, flat);
      return out;
    } catch {
      return null;
    }
  };
  const shareFigures = (state: State): Map<Id, string> => {
    const shares = sharesOf(state);
    if (shares) return new Map([...shares].map(([id, v]) => [id, fig(v, currency)]));
    const split = state["split"] as SplitSpec | null | undefined;
    let ids: Id[] = [];
    try { ids = split ? splitParticipants(split) : []; } catch { /* nobody, then */ }
    return new Map(ids.map((id) => [id, ""]));
  };
  const contributions = (state: State): Map<Id, number> => {
    const spec = coPayers(state);
    if (spec) return new Map(spec);
    const paidBy = state["paidBy"];
    const amountMinor = state["amountMinor"];
    return typeof paidBy === "string"
      ? new Map([[paidBy, typeof amountMinor === "number" ? amountMinor : 0]]) : new Map();
  };
  const modeOf = (state: State): SplitSpec["mode"] | undefined => {
    const spec = state["split"] as SplitSpec | null | undefined;
    return spec && typeof spec === "object" && spec.mode in copy.split.mode ? spec.mode : undefined;
  };

  // `entriesCarryTheirOwnRate`'s repair: names the cause, not the phone that
  // noticed, and no figure moved.
  if ((rev.entity === "expense" || rev.entity === "settlement") && !rev.isCreate
    && rev.op.patch["rateSource"] === "group"
    && Object.keys(rev.op.patch).every((k) => HEALED_RATE_FIELDS.has(k))) {
    return { what: said.rateMovedOnto(ownCurrency(rev.after)) };
  }

  if (rev.entity === "expense") {
    // Only the crossing revision carries `kind`, so read it off the fold.
    const kind = rev.after["kind"] === "income" ? "income" : "expense";
    const noun = copy.entryKind.label[kind].toLowerCase();

    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const spec = rev.after["split"] as SplitSpec | null | undefined;
      let ids: Id[] = [];
      try { ids = spec && typeof spec === "object" ? splitParticipants(spec) : []; } catch { /* just the amount */ }
      return {
        what: rev.imported ? said.importedEntry(who, noun, from) : said.createdEntry(who, noun),
        diff: amt === undefined ? undefined
          : { now: ids.length ? said.forPeople(amt, peopleText(ids, people, true)) : amt },
      };
    }
    if (rev.isDelete) return { what: said.deletedEntry(who, noun) };
    if (field("deletedAt")?.after === null) return { what: said.restoredEntry(who, noun) };

    // Collected: the first field recognised must not be the only one mentioned.
    const parts: Part[] = [];
    const named = said.field;

    // An expense is the *absence* of `kind`.
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
    let sharesPart: Part | undefined;
    if (split) {
      const was = split.before as SplitSpec | null;
      const now = split.after as SplitSpec;
      const wasFigures = was ? shareFigures(rev.before) : null;
      const nowFigures = shareFigures(rev.after);
      const rows = moves(wasFigures, nowFigures, people);
      const sameWho = !!wasFigures && wasFigures.size === nowFigures.size
        && [...nowFigures.keys()].every((id) => wasFigures.has(id));
      if (!sameWho) {
        parts.push({ what: said.changedInvolved(who), label: named.involved, rows });
      } else if (rows.length && proportions(was) !== proportions(now)) {
        const mode = modeOf(rev.after);
        const word = mode ? (copy.split.mode[mode] ?? mode).toLowerCase() : "";
        sharesPart = mode && mode !== modeOf(rev.before)
          ? { what: said.splitAs(who, word), label: named.splitAs(word), rows }
          : { what: said.changedShares(who), label: named.split, rows };
        parts.push(sharesPart);
      }
      // Same people, same money: the spec was rewritten and nobody's share moved.
    }
    // The scan and the grid move fields no sentence above names. Read as printed:
    // a line split into portions is the same bill. Loose fields: this must not
    // throw.
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
    const english = rev.after["receiptEnglish"] === true;
    // There is no singular `receiptDiscount` field.
    if ((field("receiptItems") && !reshaped) || field("receiptTip") || field("receiptTax")
      || field("receiptDiscounts") || field("receiptText")) {
      const wasLines = bill.was.lines.length;
      const nowLines = bill.now.lines.length;
      if (nowLines === 0 || wasLines === 0) {
        parts.push({
          what: nowLines === 0 ? said.removedReceipt(who) : said.addedReceipt(who),
          label: named.receipt,
          diff: {
            was: wasLines ? plural(wasLines, copy.noun.item) : undefined,
            now: nowLines ? plural(nowLines, copy.noun.item) : copy.none,
          },
        });
      } else {
        const extra = copy.items.extra;
        const charge = (state: State, key: string) => text(state[key]) ?? null;
        const deductions = (state: State): BillLine[] =>
          (Array.isArray(state["receiptDiscounts"]) ? state["receiptDiscounts"] as unknown[] : [])
            .filter((d): d is { label: string; amount: string; labelEn?: string | null } =>
              !!d && typeof d === "object" && typeof (d as { label: unknown }).label === "string"
              && typeof (d as { amount: unknown }).amount === "string")
            .map((d) => ({ label: d.label, labelEn: d.labelEn ?? null, amount: `−${d.amount}`, quantity: 1 }));
        const rows: Row[] = [
          ...billRows(bill.was.lines, bill.now.lines, english),
          ...billRows(deductions(rev.before), deductions(rev.after), english),
          ...[
            chargeRow(extra.tax, charge(rev.before, "receiptTax"), charge(rev.after, "receiptTax")),
            chargeRow(extra.tip, charge(rev.before, "receiptTip"), charge(rev.after, "receiptTip")),
          ].filter((r): r is Row => !!r),
        ];
        parts.push(rows.length
          ? { what: said.changedReceipt(who), label: named.receipt, rows }
          : { what: said.retypedBill(who), label: named.billText });
      }
    } else if (field("receiptInvolved")
      || (field("receiptAssignments") && JSON.stringify(bill.was.eaters) !== JSON.stringify(bill.now.eaters))) {
      const list = (state: State) => (Array.isArray(state["receiptInvolved"])
        ? (state["receiptInvolved"] as unknown[]).filter((id): id is Id => typeof id === "string") : []);
      const rows = bill.now.lines.flatMap((line, i) => {
        const row = eatersRow(english ? line.labelEn || line.label : line.label,
          bill.was.eaters[i] ?? [], bill.now.eaters[i] ?? [], people);
        return row ? [row] : [];
      });
      const table = eatersRow(said.atTheTable, [list(rev.before)], [list(rev.after)], people);
      if (table) rows.push(table);
      if (sharesPart) {
        const [was, now] = [sharesOf(rev.before), sharesOf(rev.after)];
        const net = was && now ? netLine(was, now, (v) => fig(v, currency), people) : "";
        if (net) rows.push({ name: net });
        parts.splice(parts.indexOf(sharesPart), 1);
      }
      parts.push({ what: said.changedWhoHadWhat(who), label: named.whoHadWhat, rows });
    }
    // Stored only when true, so any change here is a flip.
    if (field("receiptEnglish")) {
      const english = rev.after["receiptEnglish"] === true;
      const shown = copy.items.shown;
      parts.push({
        what: said.readBill(who, english),
        label: named.billLanguage,
        line: english ? { was: shown.printed, now: shown.english } : { was: shown.english, now: shown.printed },
      });
    }
    // Each figure in its own currency: `amountMinor` is the entry's, base the
    // group's.
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
    // Read off the fold: adding a co-payer moves only `payers`.
    if (field("payers") ?? field("paidBy")) {
      const before = contributions(rev.before);
      const after = contributions(rev.after);
      const sameWho = before.size === after.size && [...after.keys()].every((id) => before.has(id));
      const lone = (m: Map<Id, number>) => (m.size === 1 ? [...m.keys()][0]! : undefined);
      const [wasLone, nowLone] = [lone(before), lone(after)];
      const shown = (m: Map<Id, number>, state: State) =>
        new Map([...m].map(([id, v]) => [id, fig(v, ownCurrency(state))]));
      const change = wasLone && nowLone
        ? { diff: { was: nameOf(wasLone), now: nameOf(nowLone) } }
        : { rows: moves(shown(before, rev.before), shown(after, rev.after), people) };
      if (!sameWho) {
        parts.push({ what: said.payerWho[kind](who), label: copy.payers.title[kind], ...change });
      } else if (change.rows?.length) {
        parts.push({ what: said.payerHow[kind](who), label: named.putIn, ...change });
      }
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
    // Nothing sets a category yet (a seam), and no names are handed in to print.
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
    // The last resort: a same-meaning mode swap is the whole of some saves.
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
    if (rev.isCreate) return { what: said.newDevice(now) };
    return { what: said.became(nameOf(c?.before), now) };
  }

  if (rev.entity === "settlement") {
    if (rev.isCreate) {
      const amt = cash(field("baseAmountMinor")?.after);
      const between = field("fromMember") && field("toMember")
        ? `${nameOf(field("fromMember")!.after)} → ${nameOf(field("toMember")!.after)}` : undefined;
      return {
        what: rev.imported ? said.importedTransfer(who, from) : said.recordedTransfer(who),
        diff: amt !== undefined ? { now: between ? `${amt} · ${between}` : amt } : undefined,
      };
    }
    if (rev.isDelete) return { what: said.deletedTransfer(who) };
    if (field("deletedAt")?.after === null) return { what: said.restoredTransfer(who) };
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
    // Named after the member the revision is about, not the actor holding the
    // phone.
    const them = memberById.get(rev.entityId)?.name
      ?? (typeof field("name")?.after === "string" ? field("name")!.after as string : copy.someoneLower);
    // No self-delete exists: you can only be removed.
    const self = rev.op.actor === rev.entityId;
    if (rev.isCreate) return { what: self ? said.joined(them) : said.added(who, them) };
    if (rev.isDelete) return { what: said.removed(who, them) };
    // Lifting the tombstone is `healGroup` undoing a removal that raced an entry.
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

  // Only older builds wrote these (ADR-0005); the entity id is the currency code.
  if (rev.entity === "rate") {
    const code = rev.entityId;
    const pair = (v: unknown) =>
      (typeof v === "string" && isValidRate(v) ? said.ratePair(code, rateText(v), currency) : undefined);
    if (rev.isDelete) return { what: said.removedRate(who, code) };
    // A lift carries only `deletedAt`, and would read as "changed the MAD rate".
    if (field("deletedAt")?.after === null) return { what: said.restoredRate(code) };
    const c = field("rate");
    const now = pair(c?.after);
    if (rev.isCreate) return { what: said.setRate(who, code), diff: now ? { now } : undefined };
    if (c) return { what: said.changedRateFor(who, code), diff: { was: pair(c.before), now: now ?? "" } };
    return { what: said.changedRateFor(who, code) };
  }

  // group
  if (rev.isCreate) {
    const own = rev.after["importedFrom"];
    return {
      what: own === "tricount" || own === "file"
        ? said.importedGroup(who, said.importSource[own]) : said.createdGroup(who),
    };
  }
  if (field("name")) {
    const c = field("name")!;
    return { what: said.renamedGroup(who), diff: { was: c.before as string, now: c.after as string } };
  }
  if (field("archivedAt")) {
    return { what: field("archivedAt")!.after ? said.archivedGroup(who) : said.restoredGroup(who) };
  }
  return { what: said.updatedGroup(who) };
}
