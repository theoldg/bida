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
 *
 * **Say what moved, not both whole states.** A list of eight names struck out
 * over the same list less one is a puzzle; "− Cy" is the answer to it. Where a
 * revision moved people or lines, it gets rows (`history-rows.ts`): one per
 * kind of move, the people who moved alike together, and money where money is
 * what moved — "By items" says how a split is written, never what anybody owes.
 */

export interface Described {
  what: string;
  diff?: { was?: string; now: string };
  /** Under the sentence, where what moved is a list: people, or lines of a bill. */
  rows?: Row[];
  /**
   * Every field the revision changed, a labelled line each, in place of a
   * sentence. An entry is saved whole (`editExpense`), so several at once is
   * ordinary. **Never rank the fields**: a caption of "changed who's involved"
   * over a revision that also moved the money never mentions the money.
   */
  also?: Detail[];
}

/** One field on its own line: what it is called, and what it moved between. */
export interface Detail {
  label: string;
  was?: string;
  now?: string;
  rows?: Row[];
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
  rows?: Row[];
}

/**
 * One field moved: its sentence and diff. More than one: "edited" and an equal
 * line each.
 */
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
 * something else, whatever the amount did. A new amount moves every share's
 * money, and the amount's own line says so.
 */
function proportions(spec: SplitSpec | null | undefined): string {
  if (!spec) return "";
  const weights: Record<Id, number> = {};
  try {
    for (const id of splitParticipants(spec)) {
      const w = spec.mode === "equal" ? 1
        : spec.mode === "shares" || spec.mode === "receipt" ? spec.weights[id] ?? 0
          : spec.amounts[id] ?? 0;
      // Exact amounts are money and the rest are counts, but as a ratio they
      // are the same question.
      if (Number.isSafeInteger(w) && w > 0) weights[id] = w;
    }
    return JSON.stringify(resolveSplit(10_000, { mode: "shares", weights }).shares);
  } catch {
    return "";
  }
}

/** The entity as the fold held it — loose fields, not a typed `Expense`. */
type State = Readonly<Record<string, unknown>>;

/** Live contributions, or null for a single payer. Rows put them in name order. */
function coPayers(state: State): [Id, number][] | null {
  const spec = state["payers"];
  if (!spec || typeof spec !== "object") return null;
  const live = Object.entries(spec as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0) as [Id, number][];
  // One contributor is a single payer written the long way (`normalisePayers`
  // stores null), so nothing visible changed.
  return live.length > 1 ? live : null;
}

/**
 * Every entity kind gets a plain-English sentence and, where it helps, a diff —
 * or, where one revision moved several fields, a line for each of them.
 */
/** All `entriesCarryTheirOwnRate` writes. */
const HEALED_RATE_FIELDS = new Set(["rateToBase", "baseAmountMinor", "rateSource"]);

export function describe(
  rev: Revision,
  who: string,
  memberById: Map<string, Member>,
  currency: CurrencyCode,
  /** The group's `importedFrom`, which an imported entry's sentence names. */
  source?: ImportSource | null,
): Described {
  const said = copy.history;
  const from = source ? said.importSource[source] : undefined;
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
  const people: People = { nameOf, roster: rev.roster ?? [] };
  /**
   * A figure under a sentence about the entry. The group's own currency goes
   * bare — the amount above carries its symbol, and "CRD 20.00" six times over
   * is noise — and anything else keeps its code, so it can't pass for base.
   */
  const fig = (minor: number, code: CurrencyCode) => (code === currency ? bare(minor, code) : money(minor, code));
  /**
   * What each person owes of the entry, in the group's currency — the one
   * reading of a split that survives a change of mode, and the only one that
   * says anything about a split by items. An even split's spare cents are
   * laid flat, so "33.34, 33.33, 33.33" doesn't read as three different shares.
   * Null where the fold doesn't resolve.
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
  /** Shares as rows' figures — or, where they don't resolve, just who is in it. */
  const shareFigures = (state: State): Map<Id, string> => {
    const shares = sharesOf(state);
    if (shares) return new Map([...shares].map(([id, v]) => [id, fig(v, currency)]));
    const split = state["split"] as SplitSpec | null | undefined;
    let ids: Id[] = [];
    try { ids = split ? splitParticipants(split) : []; } catch { /* nobody, then */ }
    return new Map(ids.map((id) => [id, ""]));
  };
  /** What each payer put in, in the entry's own currency. A lone payer put in all of it. */
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

  // `entriesCarryTheirOwnRate`'s repair: the old registry's rate written onto
  // an entry that was already read at it. Names the cause, not the phone that
  // noticed, and no figure moved, so no diff. A person's save writes the whole
  // entry, so it never looks like this.
  if ((rev.entity === "expense" || rev.entity === "settlement") && !rev.isCreate
    && rev.op.patch["rateSource"] === "group"
    && Object.keys(rev.op.patch).every((k) => HEALED_RATE_FIELDS.has(k))) {
    return { what: said.rateMovedOnto(ownCurrency(rev.after)) };
  }

  if (rev.entity === "expense") {
    // Only the revision that crossed between income and expense carries `kind`,
    // so read it off the fold — or every later income edit says "edited this
    // entry".
    const kind = rev.after["kind"] === "income" ? "income" : "expense";
    const noun = copy.entryKind.label[kind].toLowerCase();

    if (rev.isCreate) {
      // The amount and who it was for — "for everyone", "for Ben, Luke". Who
      // paid and each share are a tap away, on the entry itself.
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
    /** The split's part, should a change of who had what turn out to be its cause. */
    let sharesPart: Part | undefined;
    if (split) {
      const was = split.before as SplitSpec | null;
      const now = split.after as SplitSpec;
      // What each person owes, either side, as rows — one answer to both "who
      // is in it" and "how much each", since adding Chewie halves Han's share
      // and the log owes the reader both.
      const wasFigures = was ? shareFigures(rev.before) : null;
      const nowFigures = shareFigures(rev.after);
      const rows = moves(wasFigures, nowFigures, people);
      const sameWho = !!wasFigures && wasFigures.size === nowFigures.size
        && [...nowFigures.keys()].every((id) => wasFigures.has(id));
      if (!sameWho) {
        parts.push({ what: said.changedInvolved(who), label: named.involved, rows });
      } else if (rows.length && proportions(was) !== proportions(now)) {
        // A new mode is said, in the words the entry screen heads its split
        // with: "split it by items" is why the money moved.
        const mode = modeOf(rev.after);
        sharesPart = mode && mode !== modeOf(rev.before)
          ? { what: said.splitAs(who, copy.split.mode[mode].toLowerCase()),
            label: named.splitAs(copy.split.mode[mode].toLowerCase()), rows }
          : { what: said.changedShares(who), label: named.split, rows };
        parts.push(sharesPart);
      }
      // Same people, same money: the spec was rewritten and nobody's share moved.
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
    // In whichever language the bill is shown in after the save.
    const english = rev.after["receiptEnglish"] === true;
    // `receiptDiscounts` and `receiptText`, both plural-and-spelled-out. There
    // is no singular `receiptDiscount` field — ask for one and a save that only
    // moved a bill's deductions says nothing.
    if ((field("receiptItems") && !reshaped) || field("receiptTip") || field("receiptTax")
      || field("receiptDiscounts") || field("receiptText")) {
      const wasLines = bill.was.lines.length;
      const nowLines = bill.now.lines.length;
      if (nowLines === 0 || wasLines === 0) {
        // A whole bill arriving is a count, not a list — the shares the split
        // part prints are what it meant.
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
        /** A deduction is taken off, so it is printed as one. */
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
        // Retyped and read to the same bill: the words moved, nothing they priced.
        parts.push(rows.length
          ? { what: said.changedReceipt(who), label: named.receipt, rows }
          : { what: said.retypedBill(who), label: named.billText });
      }
    } else if (field("receiptInvolved")
      || (field("receiptAssignments") && JSON.stringify(bill.was.eaters) !== JSON.stringify(bill.now.eaters))) {
      // The lines are the same either side (`reshaped`), so they pair by place.
      const list = (state: State) => (Array.isArray(state["receiptInvolved"])
        ? (state["receiptInvolved"] as unknown[]).filter((id): id is Id => typeof id === "string") : []);
      const rows = bill.now.lines.flatMap((line, i) => {
        const row = eatersRow(english ? line.labelEn || line.label : line.label,
          bill.was.eaters[i] ?? [], bill.now.eaters[i] ?? [], people);
        return row ? [row] : [];
      });
      const table = eatersRow(said.atTheTable, [list(rev.before)], [list(rev.after)], people);
      if (table) rows.push(table);
      // What the grid moved is what the split moved: one sentence, the lines
      // that changed hands, then one line of who now owes more and who less.
      if (sharesPart) {
        const [was, now] = [sharesOf(rev.before), sharesOf(rev.after)];
        const net = was && now ? netLine(was, now, (v) => fig(v, currency), people) : "";
        if (net) rows.push({ name: net });
        parts.splice(parts.indexOf(sharesPart), 1);
      }
      parts.push({ what: said.changedWhoHadWhat(who), label: named.whoHadWhat, rows });
    }
    // Stored only when true (`only`), so any change here is a flip.
    if (field("receiptEnglish")) {
      const english = rev.after["receiptEnglish"] === true;
      const shown = copy.items.shown;
      parts.push({
        what: said.readBill(who, english),
        label: named.billLanguage,
        line: english ? { was: shown.printed, now: shown.english } : { was: shown.english, now: shown.printed },
      });
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
      const before = contributions(rev.before);
      const after = contributions(rev.after);
      const sameWho = before.size === after.size && [...after.keys()].every((id) => before.has(id));
      // One payer for another is a swap of names; anything with a co-payer in
      // it is what each put in, as rows, so a third joining reads "+ Bo 10.00"
      // and not the whole list twice.
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
        what: rev.imported ? said.importedTransfer(who, from) : said.recordedTransfer(who),
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

  // A registry row, which only older builds wrote (ADR-0005). Its entity id is
  // the currency code itself, so the sentence names it without a lookup.
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
