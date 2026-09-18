import { exponentOf, isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";
import { resolveSplit } from "./split.js";

/**
 * A Splitwise CSV read back into a group — `export.ts` run the other way.
 *
 * The shape is the one that file writes and `docs/data-model.md#the-group-as-a-spreadsheet`
 * states: `Date,Description,Category,Cost,Currency` then one column per member.
 * This takes the rows already parsed out of the bytes (the parser lives in
 * `apps/web/lib/import/csv.ts`, so core stays free of a CSV dialect) and
 * returns a **plan**: what it would make, what it dropped, and whether the
 * file's own foot agrees. Nothing here writes anything.
 *
 * **Reading is liberal where writing is strict.** The bytes are the shape when
 * we emit — LF, no BOM, blank lines where Splitwise puts them — but a file
 * arriving from someone else's export, or off a round trip through Excel, may
 * carry CRLF, a BOM and a different idea of capitalisation. Every one of those
 * is accepted here. What is refused is anything that would need a guess.
 *
 * ## The one thing that does not invert
 *
 * **A member's cell is `paid − owed`.** That is a single number standing for
 * two, and no arithmetic gets both back: `(+20, −10, −10)` at a cost of 30 is
 * "A paid 30, split three ways" and half a dozen other stories equally. So the
 * reading is a *stated rule*, not a recovery:
 *
 * - **One positive column** — which is every file Splitwise itself writes — is
 *   lossless: that member paid the whole cost, and the split is `exact` with
 *   `owed = paid − delta`.
 * - **Several positive columns** are the payers, at
 *   `paidᵢ = deltaᵢ × cost / Σ positive`, distributed by the same
 *   largest-remainder method a shares split uses. Every balance comes back to
 *   the cent; the payer figures are a guess that happens to add up.
 *
 * Both need `Σ positive ≤ cost` — more net-paid than the thing cost is a row
 * no split can explain, and it would put somebody's `owed` below zero. It is
 * checked once, before either branch, and refuses the file naming the line.
 *
 * ## What is dropped and what refuses
 *
 * One rule: **a row is dropped only when it carries no money.** Every cell
 * zero contributes zero to every column total, so dropping it leaves the foot
 * checksum intact — and our own writer emits exactly that row for an expense
 * `computeBalances` could not apportion, so a round trip of our own file hits
 * it. Anything else this cannot turn into an entry **refuses the whole file**,
 * naming the line. Silently losing a row that moves money is the one outcome
 * worse than refusing.
 *
 * ## The foot is the checksum
 *
 * `Total balance` is not an entry — it is `computeBalances().byMember` as the
 * writer saw it. The plan recomputes the balances from its own entries and
 * refuses on any disagreement. That catches a misread column, a dropped row
 * that wasn't empty, and a rounding rule that drifted. It cannot catch an
 * income read backwards, which nets zero either way — that one is held by a
 * test instead.
 */

/** The five cells the format dictates, and the tokens `export.ts` writes into them. */
const HEADER = ["date", "description", "category", "cost", "currency"] as const;
const PAYMENT = "payment";
const GENERAL = "general";
const TOTAL_BALANCE = "total balance";

/** Why the file cannot be read at all. Every one names the fix. */
export type ImportRefusalCode =
  /** No rows, or nothing but blank lines. */
  | "empty"
  /** The first five columns are not the shape. */
  | "header"
  /** A header with no member columns after the five. */
  | "no-members"
  /** Two member columns with the same name — indistinguishable, so their balances would merge. */
  | "duplicate-member"
  /** A member column with no name in it. */
  | "blank-member"
  /** A row with more cells than the header has columns. */
  | "extra-cells"
  /** More than one `Currency` in the file. v1 has no rate to price them against. */
  | "mixed-currency"
  /** A `Currency` cell that is not three letters. */
  | "unknown-currency"
  /** No `Total balance` row, so there is no checksum to import against. */
  | "no-foot"
  /** A `Date` cell that is not `YYYY-MM-DD`. Guessing between 01/02 and 02/01 is not on. */
  | "bad-date"
  /** A `Cost` or member cell that is not a number. */
  | "bad-amount"
  /** A row whose member cells do not sum to zero — the shape's own invariant. */
  | "row-not-zero"
  /** `Σ positive > cost`: more was net-paid than the thing cost. */
  | "overpaid"
  /** Nothing left to import once the empty rows were dropped. */
  | "no-entries"
  /** The plan's balances disagree with the file's own foot. */
  | "checksum";

export class ImportError extends Error {
  readonly code: ImportRefusalCode;
  /** 1-based, as a spreadsheet counts them — blank lines included. */
  readonly line?: number;
  /** Whatever makes the refusal actionable: the codes found, the cell, the drift. */
  readonly detail?: string;

  constructor(code: ImportRefusalCode, message: string, line?: number, detail?: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.line = line;
    this.detail = detail;
  }
}

export interface ImportOptions {
  /**
   * `YYYY-MM-DD` to a timestamp. Local midnight of that day is the honest
   * answer and only the app knows the timezone — the same reason `export.ts`
   * takes `formatDay` rather than formatting a date itself.
   */
  dayToTimestamp: (day: string) => number;
}

/** An expense or income the plan would write. Amounts are positive minor units. */
export interface PlannedEntry {
  /** Which way it runs: a negative `Cost` is the only thing in the file that says. */
  kind: "expense" | "income";
  description: string;
  /**
   * The `Category` cell, verbatim, or null for the two protocol tokens
   * (`General`, `Payment`) which are not categories anybody chose.
   *
   * `categoryId` is free text on the entry, not an id into a table we don't
   * have, and `export.ts` already writes it straight into this column — so
   * keeping it here is the exact mirror, and folding it into the description
   * would be the invention. Nothing shows it until the picker lands
   * (docs/product.md#deliberately-not-in-the-mvp); history and a re-export
   * both do.
   */
  categoryId: string | null;
  day: string;
  occurredAt: number;
  amountMinor: number;
  /** name -> minor units handed over. Sums to `amountMinor`. */
  paid: Record<string, number>;
  /** name -> minor units owed. Sums to `amountMinor`; members owing nothing are absent. */
  owed: Record<string, number>;
  /** 1-based line it came from, for the summary screen. */
  line: number;
}

/** A transfer the plan would write. */
export interface PlannedTransfer {
  from: string;
  to: string;
  amountMinor: number;
  /** The `Description` cell, or null when it is only the `Payment` token again. */
  note: string | null;
  day: string;
  occurredAt: number;
  line: number;
}

/** A row that carried no money and was therefore dropped, checksum intact. */
export interface DroppedRow {
  line: number;
  description: string;
}

export interface ImportPlan {
  /** The file's single currency. Becomes the group's base. */
  currency: CurrencyCode;
  /** Member names in header order — the order the columns are in, which is the writer's sort. */
  members: string[];
  entries: PlannedEntry[];
  transfers: PlannedTransfer[];
  dropped: DroppedRow[];
  /** name -> minor units, as the file's `Total balance` row states them. */
  stated: Record<string, number>;
}

/** One row, with its line number and the cells padded out to the header's width. */
interface Line {
  line: number;
  cells: string[];
}

/** A cell as a comparison: BOM gone, trimmed, case folded. */
function token(cell: string | undefined): string {
  return (cell ?? "").replace(/^﻿/, "").trim().toLocaleLowerCase();
}

/** A cell as a value: BOM gone, trimmed, case as typed. */
function text(cell: string | undefined): string {
  return (cell ?? "").replace(/^﻿/, "").trim();
}

/**
 * Read the rows into a plan, or throw an `ImportError` naming the line.
 *
 * Two passes over the rows, because the currency decides how every amount in
 * the file parses and it is stated per row: find it first, then read the money.
 */
export function readCsvGroup(
  rows: readonly (readonly string[])[],
  { dayToTimestamp }: ImportOptions,
): ImportPlan {
  const lines: Line[] = [];
  rows.forEach((cells, i) => {
    // A blank line is structure in this format, not data: the shape has three
    // of them. Any row of nothing but empty cells is one.
    if (cells.every((c) => text(c) === "")) return;
    lines.push({ line: i + 1, cells: [...cells] });
  });
  if (lines.length === 0) throw new ImportError("empty", "This file has no rows in it.");

  const head = lines[0]!;
  const members = readHeader(head);
  const width = HEADER.length + members.length;
  const body = lines.slice(1);

  for (const row of body) {
    // Fewer cells is a short row, which every spreadsheet writes; more is data
    // with nowhere to go, and quietly ignoring it is how a column gets misread.
    if (row.cells.length > width) {
      throw new ImportError("extra-cells",
        `Line ${row.line} has ${row.cells.length} cells but the header has ${width}.`,
        row.line);
    }
    while (row.cells.length < width) row.cells.push("");
  }

  const currency = readCurrency(body);
  const exp = exponentOf(currency);

  // The foot, wherever it sits: found by its `Description`, never by position.
  // Its `Date` cell holds a real date, so a reader that goes by shape books
  // the checksum as an expense.
  const footIndex = body.findIndex((row) => token(row.cells[1]) === TOTAL_BALANCE);
  if (footIndex === -1) {
    throw new ImportError("no-foot",
      "This file has no “Total balance” row, so there is nothing to check the import against.");
  }
  const foot = body[footIndex]!;
  const stated: Record<string, number> = {};
  members.forEach((name, i) => {
    stated[name] = amount(foot, HEADER.length + i, currency, exp);
  });

  const entries: PlannedEntry[] = [];
  const transfers: PlannedTransfer[] = [];
  const dropped: DroppedRow[] = [];

  body.forEach((row, i) => {
    if (i === footIndex) return;
    const read = readRow(row, members, currency, exp, dayToTimestamp);
    if (read.kind === "dropped") dropped.push(read.row);
    else if (read.kind === "transfer") transfers.push(read.row);
    else entries.push(read.row);
  });

  if (entries.length === 0 && transfers.length === 0) {
    throw new ImportError("no-entries", "There is nothing in this file to import.");
  }

  checkFoot({ currency, members, entries, transfers, dropped, stated });
  return { currency, members, entries, transfers, dropped, stated };
}

/** The five columns, then the member names. */
function readHeader({ line, cells }: Line): string[] {
  // A trailing empty column is what a spreadsheet leaves behind; a blank one
  // between names is a member with no name, which is refused below.
  const trimmed = [...cells];
  while (trimmed.length > 0 && text(trimmed[trimmed.length - 1]) === "") trimmed.pop();

  const shape = HEADER.every((want, i) => token(trimmed[i]) === want);
  if (!shape) {
    throw new ImportError("header",
      "This does not look like a Splitwise export: the first five columns should be "
      + "Date, Description, Category, Cost, Currency.", line,
      trimmed.slice(0, HEADER.length).join(", "));
  }

  const names = trimmed.slice(HEADER.length).map((c) => text(c));
  if (names.length === 0) {
    throw new ImportError("no-members", "This file has no people in it — only the five columns.",
      line);
  }
  if (names.some((n) => n === "")) {
    throw new ImportError("blank-member", "One of the people columns has no name in its header.",
      line);
  }
  // Two identical headers is a file we cannot import: the columns are
  // indistinguishable, so their balances would merge into one person.
  // `export.ts` can emit it, for a group holding two members of one name
  // written before ADR-0034, and says nothing can be done about that.
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new ImportError("duplicate-member",
        `Two columns are both called “${name}”, so there is no telling which balance is whose.`,
        line, name);
    }
    seen.add(key);
  }
  return names;
}

/** The file's one currency. More than one is refused by name; v1 has no rate to bridge them. */
function readCurrency(body: readonly Line[]): CurrencyCode {
  const found = new Set<string>();
  for (const row of body) {
    const code = text(row.cells[HEADER.length - 1]).toLocaleUpperCase();
    if (code === "") continue;
    if (!isCurrencyCode(code)) {
      throw new ImportError("unknown-currency",
        `Line ${row.line} has “${code}” where a three-letter currency should be.`, row.line, code);
    }
    found.add(code);
  }
  const codes = [...found].sort();
  if (codes.length === 0) {
    throw new ImportError("unknown-currency", "No row in this file says what currency it is in.");
  }
  if (codes.length > 1) {
    // The foot sums across currencies, so the checksum is gone exactly where
    // the import would be least sure. Refusing beats importing unchecked.
    throw new ImportError("mixed-currency",
      `This file mixes ${codes.join(" and ")}. bida can only import one currency at a time.`,
      undefined, codes.join(","));
  }
  return codes[0]!;
}

/** One money cell. Empty is zero; anything unparseable refuses the file. */
function amount(row: Line, index: number, currency: CurrencyCode, exp: number): number {
  const raw = text(row.cells[index]);
  if (raw === "") return 0;
  let minor: number;
  try {
    minor = parseMinor(raw, currency);
  } catch {
    throw new ImportError("bad-amount",
      `Line ${row.line} has “${raw}” where an amount should be.`, row.line, raw);
  }
  // `parseMinor` rounds excess precision away, which is right for a keyboard
  // and wrong for a file: a cell with more decimals than the currency has is
  // either the wrong currency or the wrong column, and rounding somebody's
  // money to hide that is not ours to do.
  const frac = raw.replace(/\s/g, "").replace(",", ".").split(".")[1] ?? "";
  if (frac.length > exp) {
    throw new ImportError("bad-amount",
      `Line ${row.line} has “${raw}”, which is more decimal places than ${currency} has.`,
      row.line, raw);
  }
  return minor;
}

type ReadRow =
  | { kind: "entry"; row: PlannedEntry }
  | { kind: "transfer"; row: PlannedTransfer }
  | { kind: "dropped"; row: DroppedRow };

function readRow(
  row: Line,
  members: readonly string[],
  currency: CurrencyCode,
  exp: number,
  dayToTimestamp: (day: string) => number,
): ReadRow {
  const description = text(row.cells[1]);
  const category = text(row.cells[2]);
  const cost = amount(row, 3, currency, exp);

  const deltas = members.map((_, i) => amount(row, HEADER.length + i, currency, exp));
  const net = deltas.reduce((a, b) => a + b, 0);
  if (net !== 0) {
    throw new ImportError("row-not-zero",
      `Line ${row.line} does not balance: its people's figures add up to `
      + `${minorToDecimalString(net, currency)} instead of nothing.`, row.line);
  }
  // Every cell zero: the row says a thing cost money and nothing about who,
  // which is what our own writer emits for an expense it could not apportion.
  // It adds nothing to any column total, so dropping it keeps the checksum.
  if (deltas.every((d) => d === 0)) return { kind: "dropped", row: { line: row.line, description } };

  const day = text(row.cells[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRealDay(day)) {
    // `01/02/2026` is two different days on two continents. There is no
    // reading of it that is true, so the file is refused rather than guessed at.
    throw new ImportError("bad-date",
      `Line ${row.line} has “${day}” where a date should be. bida reads YYYY-MM-DD.`,
      row.line, day);
  }
  const occurredAt = dayToTimestamp(day);

  const transfer = asTransfer(row, members, deltas, cost, category, description, day, occurredAt);
  if (transfer) return { kind: "transfer", row: transfer };

  // An income runs the other way through the one amount column, and through
  // the member columns with it: `export.ts` writes `owed − paid` for one and
  // `paid − owed` for the other. Flip it back and the rest of this function
  // does not need to know which it is.
  const income = cost < 0;
  const amountMinor = Math.abs(cost);
  const net_ = deltas.map((d) => (income ? -d : d));

  const positive = net_.reduce((a, d) => a + Math.max(0, d), 0);
  if (positive > amountMinor) {
    throw new ImportError("overpaid",
      `Line ${row.line} says ${minorToDecimalString(positive, currency)} was paid towards `
      + `something that cost ${minorToDecimalString(amountMinor, currency)}, which no split explains.`,
      row.line);
  }

  const paid = payersOf(members, net_, amountMinor, row.line, description);
  const owed: Record<string, number> = {};
  members.forEach((name, i) => {
    const share = (paid[name] ?? 0) - (net_[i] ?? 0);
    // A member who owes nothing is left out rather than carried at zero: it is
    // what a person would have entered, and `resolveSplit` reads an `exact`
    // split off exactly this map.
    if (share !== 0) owed[name] = share;
  });

  return {
    kind: "entry",
    row: {
      kind: income ? "income" : "expense",
      description,
      // `General` and `Payment` are protocol tokens, not categories anybody
      // picked, so they come in as nothing.
      categoryId: category === "" || token(category) === GENERAL || token(category) === PAYMENT
        ? null : category,
      day,
      occurredAt,
      amountMinor,
      paid,
      owed,
      line: row.line,
    },
  };
}

/**
 * A transfer, or nothing.
 *
 * Two things have to agree: the `Category` cell says `Payment` — the token
 * `export.ts` writes and Splitwise writes too — **and** the row has the shape
 * of one, which is exactly two non-zero figures, equal and opposite, sized to
 * the cost. The shape test is free and it is what keeps a row titled "payment
 * for dinner" an expense: nothing here reads the description, because a
 * keyword list in free text turns real expenses into transfers.
 *
 * Category says `Payment` while the shape disagrees → it comes in as an
 * expense, which is the reading that loses nothing.
 */
function asTransfer(
  row: Line,
  members: readonly string[],
  deltas: readonly number[],
  cost: number,
  category: string,
  description: string,
  day: string,
  occurredAt: number,
): PlannedTransfer | undefined {
  if (token(category) !== PAYMENT || cost <= 0) return undefined;
  const moved = members
    .map((name, i) => ({ name, delta: deltas[i] ?? 0 }))
    .filter((m) => m.delta !== 0);
  if (moved.length !== 2) return undefined;
  const [a, b] = moved as [{ name: string; delta: number }, { name: string; delta: number }];
  const from = a.delta > 0 ? a : b;
  const to = a.delta > 0 ? b : a;
  if (from.delta !== cost || to.delta !== -cost) return undefined;
  return {
    from: from.name,
    to: to.name,
    amountMinor: cost,
    // With no note of its own the row says only what it is, and that cell is
    // the token rather than something a person wrote.
    note: token(description) === PAYMENT || description === "" ? null : description,
    day,
    occurredAt,
    line: row.line,
  };
}

/**
 * Who paid, from the positive columns. `Σ positive ≤ cost` is already checked.
 *
 * One positive column is the lossless case and the only one Splitwise itself
 * writes: that member paid the whole thing. Several are apportioned by their
 * figures through the same largest-remainder distribution a shares split uses,
 * so they sum to the cost exactly on every device. Seeded off the row, so the
 * leftover minor unit is deterministic without needing an entity id that does
 * not exist yet.
 */
function payersOf(
  members: readonly string[],
  net: readonly number[],
  amountMinor: number,
  line: number,
  description: string,
): Record<string, number> {
  const payers = members
    .map((name, i) => ({ name, delta: net[i] ?? 0 }))
    .filter((m) => m.delta > 0);

  if (payers.length === 1) return { [payers[0]!.name]: amountMinor };

  const weights: Record<string, number> = {};
  for (const p of payers) weights[p.name] = p.delta;
  return resolveSplit(amountMinor, { mode: "shares", weights }, {
    tiebreakSeed: `${line}:${description}`,
  }).shares;
}

/** `2026-02-30` parses as a date and is not one. */
function isRealDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/**
 * The plan's own balances against the file's foot, to the cent.
 *
 * This is the whole reason the foot is worth reading: it is
 * `computeBalances().byMember` as the writer saw it, so recomputing it from
 * the entries this plan would write catches a misread column, a row dropped
 * that wasn't empty, and a rounding rule that drifted — before anything is
 * written. Computed from the plan rather than by folding it, because the plan
 * is what the person is about to approve.
 */
function checkFoot(plan: ImportPlan): void {
  const computed: Record<string, number> = {};
  const move = (name: string, minor: number) => {
    computed[name] = (computed[name] ?? 0) + minor;
  };
  for (const name of plan.members) computed[name] = 0;

  for (const e of plan.entries) {
    const sign = e.kind === "income" ? -1 : 1;
    for (const [name, minor] of Object.entries(e.paid)) move(name, sign * minor);
    for (const [name, minor] of Object.entries(e.owed)) move(name, -sign * minor);
  }
  for (const t of plan.transfers) {
    move(t.from, t.amountMinor);
    move(t.to, -t.amountMinor);
  }

  const drift = plan.members
    .filter((name) => (computed[name] ?? 0) !== (plan.stated[name] ?? 0))
    .map((name) => `${name}: ${minorToDecimalString(computed[name] ?? 0, plan.currency)}`
      + ` vs ${minorToDecimalString(plan.stated[name] ?? 0, plan.currency)}`);
  if (drift.length > 0) {
    throw new ImportError("checksum",
      "The balances this would produce do not match the file's own “Total balance” row, "
      + "so something in it is being read wrong.", undefined, drift.join("; "));
  }
}

/** How many entries a plan would write, which is what the summary counts. */
export function plannedCount(plan: ImportPlan): number {
  return plan.entries.length + plan.transfers.length;
}
