// Doc: docs/import-export.md#reading-one-back
import { exponentOf, isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money";
import { resolveSplit } from "./split";
import type { ImportSource } from "./types";

/**
 * A Splitwise CSV read back into a plan — `export.ts` in reverse; nothing here
 * writes. Refuses anything that needs a guess, naming the line.
 *
 * A member's cell is `paid − owed`, which does not invert: several positive
 * columns become payers by largest remainder, balances exact and payer figures a
 * guess. The `Total balance` foot, one per currency, is the checksum.
 */

const HEADER = ["date", "description", "category", "cost", "currency"] as const;
const PAYMENT = "payment";
const GENERAL = "general";
const TOTAL_BALANCE = "total balance";

/**
 * Why the file cannot be read at all; the person reads `copy.importData.refused`.
 */
export type ImportRefusalCode =
  | "empty"
  | "header"
  | "no-members"
  | "duplicate-member"
  | "blank-member"
  | "bad-member-name"
  | "extra-cells"
  | "mixed-currency"
  | "unknown-currency"
  | "blank-currency"
  | "no-foot"
  | "duplicate-foot"
  | "bad-date"
  | "bad-amount"
  | "too-precise"
  | "row-not-zero"
  | "overpaid"
  | "no-entries"
  | "checksum"
  | "not-tricount"
  | "tricount-amount"
  | "tricount-date"
  | "tricount-split";

export class ImportError extends Error {
  readonly code: ImportRefusalCode;
  /** 1-based, as a spreadsheet counts them — blank lines included. */
  readonly line?: number;
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
  /** Local midnight; only the app knows the timezone. */
  dayToTimestamp: (day: string) => number;
}

/** Amounts are positive minor units. */
export interface PlannedEntry {
  kind: "expense" | "income";
  description: string;
  /** Null for the tokens `General` and `Payment`, which nobody chose. */
  categoryId: string | null;
  day: string;
  occurredAt: number;
  /** Written as `createdAt`, the order inside a day. A CSV never has one. */
  recordedAt?: number;
  amountMinor: number;
  paid: Record<string, number>;
  /** Members owing nothing are absent. */
  owed: Record<string, number>;
  local?: LocalMoney;
  parts?: Record<string, number>;
  /** Absent means the plan's — always, for a tricount. */
  currency?: CurrencyCode;
  line: number;
}

/**
 * Only a hint: `shapeEntry` writes it when a rate reproduces the base figure
 * exactly, and the base figure otherwise.
 */
export interface LocalMoney {
  currency: CurrencyCode;
  amountMinor: number;
  /** 1 `currency` = `rate` base, if the source gave one. */
  rate: string | null;
  owed?: Record<string, number>;
}

export interface PlannedTransfer {
  from: string;
  to: string;
  amountMinor: number;
  note: string | null;
  local?: Omit<LocalMoney, "owed">;
  currency?: CurrencyCode;
  day: string;
  occurredAt: number;
  recordedAt?: number;
  line: number;
}

interface DroppedRow {
  line: number;
  description: string;
}

export interface ImportPlan {
  source: ImportSource;
  title?: string;
  currency: CurrencyCode;
  members: string[];
  entries: PlannedEntry[];
  transfers: PlannedTransfer[];
  dropped: DroppedRow[];
  stated: Record<string, number>;
  statedOther?: Record<CurrencyCode, Record<string, number>>;
}

interface Line {
  line: number;
  cells: string[];
}

function token(cell: string | undefined): string {
  return (cell ?? "").replace(/^\uFEFF/, "").trim().toLocaleLowerCase();
}

function text(cell: string | undefined): string {
  return (cell ?? "").replace(/^\uFEFF/, "").trim();
}

/**
 * **Never `map[name] ?? 0`**: names come from somebody else's file and
 * `map["constructor"]` is a function.
 */
export function at(map: Record<string, number>, key: string): number {
  return Object.hasOwn(map, key) ? map[key]! : 0;
}

export function readCsvGroup(
  rows: readonly (readonly string[])[],
  { dayToTimestamp }: ImportOptions,
): ImportPlan {
  const lines: Line[] = [];
  rows.forEach((cells, i) => {
    if (cells.every((c) => text(c) === "")) return;
    lines.push({ line: i + 1, cells: [...cells] });
  });
  if (lines.length === 0) throw new ImportError("empty", "no rows");

  const head = lines[0]!;
  const members = readHeader(head);
  const width = HEADER.length + members.length;
  const body = lines.slice(1);

  for (const row of body) {
    // Fewer cells is a normal short row; more is how a column gets misread.
    if (row.cells.length > width) {
      throw new ImportError("extra-cells",
        `line ${row.line}: ${row.cells.length} cells, header has ${width}`,
        row.line, `${row.cells.length}/${width}`);
    }
    while (row.cells.length < width) row.cells.push("");
  }

  const currencyOf = readCurrencies(body);

  // By its `Description`, never by position: its `Date` cell holds a real date.
  const isFoot = (row: Line) => token(row.cells[1]) === TOTAL_BALANCE;
  const feet = new Map<CurrencyCode, Record<string, number>>();
  for (const row of body) {
    if (!isFoot(row)) continue;
    const code = currencyOf(row);
    if (feet.has(code)) {
      throw new ImportError("duplicate-foot", `line ${row.line}: a second foot for ${code}`, row.line, code);
    }
    const stated: Record<string, number> = {};
    members.forEach((name, i) => {
      stated[name] = amount(row, HEADER.length + i, code, exponentOf(code));
    });
    feet.set(code, stated);
  }
  if (feet.size === 0) throw new ImportError("no-foot", "no Total balance row");

  const entries: PlannedEntry[] = [];
  const transfers: PlannedTransfer[] = [];
  const dropped: DroppedRow[] = [];
  const counts = new Map<CurrencyCode, number>();

  for (const row of body) {
    if (isFoot(row)) continue;
    const code = currencyOf(row);
    const read = readRow(row, members, code, exponentOf(code), dayToTimestamp);
    if (read.kind === "dropped") {
      dropped.push(read.row);
      continue;
    }
    if (!feet.has(code)) {
      throw new ImportError("no-foot", `no Total balance row for ${code}`, undefined, code);
    }
    counts.set(code, (counts.get(code) ?? 0) + 1);
    if (read.kind === "transfer") transfers.push({ ...read.row, currency: code });
    else entries.push({ ...read.row, currency: code });
  }

  if (entries.length === 0 && transfers.length === 0) {
    throw new ImportError("no-entries", "nothing to import");
  }

  let currency = [...counts.keys()][0]!;
  for (const [code, n] of counts) if (n > counts.get(currency)!) currency = code;
  const ownCurrency = <T extends { currency?: CurrencyCode }>(row: T): T => {
    if (row.currency !== currency) return row;
    const { currency: _, ...rest } = row;
    return rest as T;
  };
  const statedOther: Record<CurrencyCode, Record<string, number>> = {};
  for (const [code, stated] of feet) if (code !== currency) statedOther[code] = stated;

  const plan: ImportPlan = {
    source: "file",
    currency,
    members,
    entries: entries.map(ownCurrency),
    transfers: transfers.map(ownCurrency),
    dropped,
    stated: feet.get(currency)!,
    ...(Object.keys(statedOther).length > 0 ? { statedOther } : {}),
  };
  checkStated(plan);
  return plan;
}

function readHeader({ line, cells }: Line): string[] {
  const trimmed = [...cells];
  while (trimmed.length > 0 && text(trimmed[trimmed.length - 1]) === "") trimmed.pop();

  const shape = HEADER.every((want, i) => token(trimmed[i]) === want);
  if (!shape) {
    throw new ImportError("header", "first five columns are not the shape", line,
      trimmed.slice(0, HEADER.length).join(", "));
  }

  const names = trimmed.slice(HEADER.length).map((c) => text(c));
  checkMemberNames(names, line);
  return names;
}

export function checkMemberNames(names: readonly string[], line?: number): void {
  if (names.length === 0) throw new ImportError("no-members", "no members", line);
  if (names.some((n) => n === "")) {
    throw new ImportError("blank-member", "a member has no name", line);
  }
  // Assigning `__proto__` stores nothing, so the figures would vanish into a
  // baffling checksum mismatch.
  const reserved = names.find((n) => n === "__proto__");
  if (reserved !== undefined) {
    throw new ImportError("bad-member-name", `a member is called ${reserved}`, line, reserved);
  }
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new ImportError("duplicate-member", `two members called ${name}`, line, name);
    }
    seen.add(key);
  }
}

/**
 * A blank cell is fine while the file holds one currency, refused once it holds
 * several.
 */
function readCurrencies(body: readonly Line[]): (row: Line) => CurrencyCode {
  const codeOf = (row: Line) => text(row.cells[HEADER.length - 1]).toLocaleUpperCase();
  const found = new Set<CurrencyCode>();
  for (const row of body) {
    const code = codeOf(row);
    if (code === "") continue;
    if (!isCurrencyCode(code)) {
      throw new ImportError("unknown-currency", `line ${row.line}: ${code} is not a currency`, row.line, code);
    }
    found.add(code);
  }
  if (found.size === 0) throw new ImportError("unknown-currency", "nothing states a currency");
  const only = found.size === 1 ? [...found][0]! : undefined;
  return (row) => {
    const code = codeOf(row);
    if (code !== "") return code;
    if (only) return only;
    throw new ImportError("blank-currency", `line ${row.line} states no currency`, row.line);
  };
}

/**
 * More than one is refused: a tricount's `amount`s are all in its own, so a
 * second means a payload we don't understand.
 */
export function oneCurrency(stated: Iterable<{ code: string; line?: number }>): CurrencyCode {
  const found = new Set<string>();
  for (const { code, line } of stated) {
    if (code === "") continue;
    if (!isCurrencyCode(code)) {
      throw new ImportError("unknown-currency",
        `${line === undefined ? "" : `line ${line}: `}${code} is not a currency`, line, code);
    }
    found.add(code);
  }
  const codes = [...found].sort();
  if (codes.length === 0) throw new ImportError("unknown-currency", "nothing states a currency");
  if (codes.length > 1) {
    throw new ImportError("mixed-currency", `mixes ${codes.join(",")}`, undefined, codes.join(", "));
  }
  return codes[0]!;
}

function amount(row: Line, index: number, currency: CurrencyCode, exp: number): number {
  const raw = text(row.cells[index]);
  return strictMinor(raw, currency, exp, (why) => why === "unreadable"
    ? new ImportError("bad-amount", `line ${row.line}: ${raw} is not an amount`, row.line, raw)
    : new ImportError("too-precise", `line ${row.line}: ${raw} is finer than ${currency}`,
      row.line, `${raw} — ${currency}`));
}

/**
 * Excess precision is refused, not rounded as `parseMinor` would: extra decimals
 * mean the wrong currency or column.
 */
export function strictMinor(
  raw: string,
  currency: CurrencyCode,
  exp: number,
  refuse: (why: "unreadable" | "too-fine") => ImportError,
): number {
  if (raw === "") return 0;
  let minor: number;
  try {
    minor = parseMinor(raw, currency);
  } catch {
    throw refuse("unreadable");
  }
  const frac = raw.replace(/\s/g, "").replace(",", ".").split(".")[1] ?? "";
  if (frac.length > exp) throw refuse("too-fine");
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
    // Omitted rather than zero: `resolveSplit` reads an `exact` split off this
    // map.
    if (share !== 0) owed[name] = share;
  });

  return {
    kind: "entry",
    row: {
      kind: income ? "income" : "expense",
      description,
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
 * Needs the `Payment` category **and** the shape: two equal and opposite figures
 * sized to the cost. Never reads the description ("payment for dinner").
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
    note: token(description) === PAYMENT || description === "" ? null : description,
    day,
    occurredAt,
    line: row.line,
  };
}

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
export function isRealDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** Computed from the plan, because that is what the person approves. */
export function checkStated(plan: ImportPlan): void {
  const computed = new Map<CurrencyCode, Record<string, number>>();
  const move = (code: CurrencyCode, name: string, minor: number) => {
    const sums = computed.get(code) ?? {};
    sums[name] = at(sums, name) + minor;
    computed.set(code, sums);
  };

  for (const e of plan.entries) {
    const code = e.currency ?? plan.currency;
    const sign = e.kind === "income" ? -1 : 1;
    for (const [name, minor] of Object.entries(e.paid)) move(code, name, sign * minor);
    for (const [name, minor] of Object.entries(e.owed)) move(code, name, -sign * minor);
  }
  for (const t of plan.transfers) {
    const code = t.currency ?? plan.currency;
    move(code, t.from, t.amountMinor);
    move(code, t.to, -t.amountMinor);
  }

  const feet: [CurrencyCode, Record<string, number>][] = [
    [plan.currency, plan.stated], ...Object.entries(plan.statedOther ?? {}),
  ];
  const drift: string[] = [];
  for (const [code, stated] of feet) {
    const sums = computed.get(code) ?? {};
    for (const name of plan.members) {
      if (at(sums, name) === at(stated, name)) continue;
      drift.push(`${name}: ${minorToDecimalString(at(sums, name), code)}`
        + ` vs ${minorToDecimalString(at(stated, name), code)}`);
    }
  }
  if (drift.length > 0) {
    throw new ImportError("checksum", "balances disagree with the foot", undefined,
      drift.join("; "));
  }
}

export function ratesWanted(plan: ImportPlan): { currency: CurrencyCode; day: string }[] {
  const keys = new Set<string>();
  for (const row of [...plan.entries, ...plan.transfers]) {
    if (row.currency && row.currency !== plan.currency) keys.add(`${row.currency} ${row.day}`);
  }
  return [...keys].sort().map((key) => {
    const [currency, day] = key.split(" ") as [CurrencyCode, string];
    return { currency, day };
  });
}

export function otherCurrencies(plan: ImportPlan): CurrencyCode[] {
  const counts = new Map<CurrencyCode, number>();
  for (const row of [...plan.entries, ...plan.transfers]) {
    if (row.currency && row.currency !== plan.currency) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
}

export function plannedCount(plan: ImportPlan): number {
  return plan.entries.length + plan.transfers.length;
}
