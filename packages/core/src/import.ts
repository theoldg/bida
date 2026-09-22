import { exponentOf, isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";
import { resolveSplit } from "./split.js";

/**
 * A Splitwise CSV read back into a group — `export.ts` in reverse. Takes parsed
 * rows (the dialect is `apps/web/lib/import/csv.ts`) and returns a **plan**;
 * nothing here writes. Liberal in what it reads (CRLF, BOM, case), but refuses
 * anything that needs a guess. docs/data-model.md#the-group-as-a-spreadsheet.
 *
 * **A member's cell is `paid − owed`**, which does not invert. One positive
 * column (every file Splitwise writes) is lossless: that member paid, split
 * `exact` at `paid − delta`. Several positive columns become payers at
 * `deltaᵢ × cost / Σ positive` by largest remainder — balances exact, payer
 * figures a guess. Both need `Σ positive ≤ cost`.
 *
 * A row is dropped only when it carries no money; anything else that can't
 * become an entry refuses the whole file, naming the line.
 *
 * The `Total balance` foot is the checksum: recomputing it from the plan catches
 * a misread column, a wrong drop and rounding drift. It can't catch an income
 * read backwards (nets zero); a test holds that.
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
  /** A member column named something JavaScript cannot hold as a plain key. */
  | "bad-member-name"
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
  /** A cell with more decimal places than the currency has. */
  | "too-precise"
  /** A row whose member cells do not sum to zero — the shape's own invariant. */
  | "row-not-zero"
  /** `Σ positive > cost`: more was net-paid than the thing cost. */
  | "overpaid"
  /** Nothing left to import once the empty rows were dropped. */
  | "no-entries"
  /** The plan's balances disagree with the ones the source stated. */
  | "checksum"
  /** The JSON behind a tricount link is not a tricount. (`tricount.ts`) */
  | "not-tricount"
  /** A tricount entry whose amount is not a number the currency can hold. */
  | "tricount-amount"
  /** A tricount entry with no date in it, or one that is not a real day. */
  | "tricount-date"
  /** A tricount entry whose shares do not add up to what it cost. */
  | "tricount-split";

/**
 * Why a file was refused. `message` is for a developer; the person reads
 * `copy.importData.refused[code]`, interpolating `line` and `detail`.
 */
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

interface ImportOptions {
  /** `YYYY-MM-DD` to a timestamp at local midnight; only the app knows the timezone. */
  dayToTimestamp: (day: string) => number;
}

/** An expense or income the plan would write. Amounts are positive minor units. */
export interface PlannedEntry {
  /** Which way it runs: a negative `Cost` is the only thing in the file that says. */
  kind: "expense" | "income";
  description: string;
  /**
   * The `Category` cell verbatim, or null for the tokens `General` and
   * `Payment`, which nobody chose — the exact mirror of what `export.ts` writes.
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
interface DroppedRow {
  line: number;
  description: string;
}

export interface ImportPlan {
  /** The group's name, when the source has one (a tricount does; a CSV's is the filename). */
  title?: string;
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
  return (cell ?? "").replace(/^\uFEFF/, "").trim().toLocaleLowerCase();
}

/** A cell as a value: BOM gone, trimmed, case as typed. */
function text(cell: string | undefined): string {
  return (cell ?? "").replace(/^\uFEFF/, "").trim();
}

/**
 * A figure keyed by a member's name. **Never `map[name] ?? 0`**: names come
 * from somebody else's file and `map["constructor"]` is a function, giving
 * NaN. `__proto__` is refused at the header instead (`readHeader`).
 */
export function at(map: Record<string, number>, key: string): number {
  return Object.hasOwn(map, key) ? map[key]! : 0;
}

/**
 * Read the rows into a plan, or throw an `ImportError` naming the line. The
 * currency decides how every amount parses, so it is found first.
 */
export function readCsvGroup(
  rows: readonly (readonly string[])[],
  { dayToTimestamp }: ImportOptions,
): ImportPlan {
  const lines: Line[] = [];
  rows.forEach((cells, i) => {
    // Blank lines are structure in this format, not data.
    if (cells.every((c) => text(c) === "")) return;
    lines.push({ line: i + 1, cells: [...cells] });
  });
  if (lines.length === 0) throw new ImportError("empty", "no rows");

  const head = lines[0]!;
  const members = readHeader(head);
  const width = HEADER.length + members.length;
  const body = lines.slice(1);

  for (const row of body) {
    // Fewer cells is a normal short row. More is data with nowhere to go, and
    // ignoring it is how a column gets misread.
    if (row.cells.length > width) {
      throw new ImportError("extra-cells",
        `line ${row.line}: ${row.cells.length} cells, header has ${width}`,
        row.line, `${row.cells.length}/${width}`);
    }
    while (row.cells.length < width) row.cells.push("");
  }

  const currency = readCurrency(body);
  const exp = exponentOf(currency);

  // Found by its `Description`, never by position: its `Date` cell holds a real
  // date, so a shape-based reader books the checksum as an expense.
  const footIndex = body.findIndex((row) => token(row.cells[1]) === TOTAL_BALANCE);
  if (footIndex === -1) {
    throw new ImportError("no-foot", "no Total balance row");
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
    throw new ImportError("no-entries", "nothing to import");
  }

  checkStated({ currency, members, entries, transfers, dropped, stated });
  return { currency, members, entries, transfers, dropped, stated };
}

/** The five columns, then the member names. */
function readHeader({ line, cells }: Line): string[] {
  // A trailing empty column is spreadsheet debris; a blank one between names
  // is a member with no name, refused below.
  const trimmed = [...cells];
  while (trimmed.length > 0 && text(trimmed[trimmed.length - 1]) === "") trimmed.pop();

  const shape = HEADER.every((want, i) => token(trimmed[i]) === want);
  if (!shape) {
    throw new ImportError("header", "first five columns are not the shape", line,
      trimmed.slice(0, HEADER.length).join(", "));
  }

  const names = trimmed.slice(HEADER.length).map((c) => text(c));
  if (names.length === 0) {
    throw new ImportError("no-members", "no member columns", line);
  }
  if (names.some((n) => n === "")) {
    throw new ImportError("blank-member", "a member column has no name", line);
  }
  // Assigning `__proto__` on a plain object stores nothing, so the figures would
  // vanish and surface as a baffling checksum mismatch later.
  const reserved = names.find((n) => n === "__proto__");
  if (reserved !== undefined) {
    throw new ImportError("bad-member-name", `member column named ${reserved}`, line, reserved);
  }
  // Would merge two people's balances. `export.ts` emits this for a group
  // holding two members of one name.
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new ImportError("duplicate-member",
        `two columns named ${name}`, line, name);
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
      throw new ImportError("unknown-currency", `line ${row.line}: ${code} is not a currency`,
        row.line, code);
    }
    found.add(code);
  }
  const codes = [...found].sort();
  if (codes.length === 0) {
    throw new ImportError("unknown-currency", "no row states a currency");
  }
  if (codes.length > 1) {
    // The foot sums across currencies, so the checksum is meaningless.
    throw new ImportError("mixed-currency", `mixes ${codes.join(",")}`, undefined,
      codes.join(", "));
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
    throw new ImportError("bad-amount", `line ${row.line}: ${raw} is not an amount`,
      row.line, raw);
  }
  // `parseMinor` rounds excess precision, right for a keyboard but wrong here:
  // extra decimals mean the wrong currency or column.
  const frac = raw.replace(/\s/g, "").replace(",", ".").split(".")[1] ?? "";
  if (frac.length > exp) {
    throw new ImportError("too-precise", `line ${row.line}: ${raw} is finer than ${currency}`,
      row.line, `${raw} — ${currency}`);
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
    throw new ImportError("row-not-zero", `line ${row.line}: members sum to ${net}`,
      row.line, minorToDecimalString(net, currency));
  }
  // What our own writer emits for an expense it could not apportion.
  if (deltas.every((d) => d === 0)) return { kind: "dropped", row: { line: row.line, description } };

  const day = text(row.cells[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRealDay(day)) {
    // `01/02/2026` is two different days on two continents.
    throw new ImportError("bad-date",
      `line ${row.line}: ${day} is not YYYY-MM-DD`, row.line, day);
  }
  const occurredAt = dayToTimestamp(day);

  const transfer = asTransfer(row, members, deltas, cost, category, description, day, occurredAt);
  if (transfer) return { kind: "transfer", row: transfer };

  // An income is negative in the amount and member columns alike; flip it here.
  const income = cost < 0;
  const amountMinor = Math.abs(cost);
  const net_ = deltas.map((d) => (income ? -d : d));

  const positive = net_.reduce((a, d) => a + Math.max(0, d), 0);
  if (positive > amountMinor) {
    throw new ImportError("overpaid",
      `line ${row.line}: ${positive} paid towards a cost of ${amountMinor}`, row.line,
      `${minorToDecimalString(positive, currency)} towards `
      + minorToDecimalString(amountMinor, currency));
  }

  const paid = payersOf(members, net_, amountMinor, row.line, description);
  const owed: Record<string, number> = {};
  members.forEach((name, i) => {
    const share = at(paid, name) - (net_[i] ?? 0);
    // Omitted rather than zero: `resolveSplit` reads an `exact` split off this map.
    if (share !== 0) owed[name] = share;
  });

  return {
    kind: "entry",
    row: {
      kind: income ? "income" : "expense",
      description,
      // Protocol tokens, not categories anybody picked.
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
 * A transfer, or null. Needs the `Payment` category **and** the shape: two
 * non-zero figures, equal and opposite, sized to the cost. Never reads the
 * description ("payment for dinner"). Token without shape imports as an expense.
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
    // The bare token is not something a person wrote.
    note: token(description) === PAYMENT || description === "" ? null : description,
    day,
    occurredAt,
    line: row.line,
  };
}

/**
 * Who paid, from the positive columns. Several are apportioned by the
 * shares-split distribution, seeded off the row since no entity id exists yet.
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
 * The plan's balances against the source's, to the cent. Computed from the
 * plan because that is what the person approves. `tricount.ts` checks through
 * here too.
 */
export function checkStated(plan: ImportPlan): void {
  const computed: Record<string, number> = {};
  const move = (name: string, minor: number) => {
    computed[name] = at(computed, name) + minor;
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
    .filter((name) => at(computed, name) !== at(plan.stated, name))
    .map((name) => `${name}: ${minorToDecimalString(at(computed, name), plan.currency)}`
      + ` vs ${minorToDecimalString(at(plan.stated, name), plan.currency)}`);
  if (drift.length > 0) {
    throw new ImportError("checksum", "balances disagree with the foot", undefined,
      drift.join("; "));
  }
}

/** How many entries a plan would write, which is what the summary counts. */
export function plannedCount(plan: ImportPlan): number {
  return plan.entries.length + plan.transfers.length;
}
