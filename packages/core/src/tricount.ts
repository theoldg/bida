import {
  at, checkMemberNames, checkStated, ImportError, isRealDay, oneCurrency, strictMinor,
  type ImportPlan, type LocalMoney, type PlannedEntry, type PlannedTransfer,
} from "./import.js";
import { exponentOf, isCurrencyCode, minorToDecimalString, type CurrencyCode } from "./money.js";

/**
 * A tricount read into the same **plan** `import.ts` returns from a CSV.
 * Nothing here writes or fetches: the JSON comes from
 * `apps/web/lib/import/tricount.ts` via the Worker
 * (docs/data-model.md#reading-a-tricount-back).
 *
 * A group is a `Registry` of `memberships` and `all_registry_entry`, each entry
 * with an `amount`, the membership that `owned` it (who paid) and `allocations`
 * (whose it was). Every figure is **signed from the group's side** — expenses
 * negative — and converted to positive minor units in one place.
 *
 * Unlike a CSV this inverts exactly: payer and shares are stated separately,
 * and Tricount has no multi-payer expense. The one rule: a repayment is a
 * transfer only if it is `BALANCE` *and* has exactly one recipient; otherwise
 * it imports as an expense.
 *
 * There is no foot row, so the checksum is computed from the raw figures by
 * the app's own route (allocations minus owned), not the plan's — which is why
 * it catches a transfer backwards, an unflipped income or a wrong payer.
 *
 * Every `amount` is in the tricount's own currency. An entry spent in another
 * says so beside it — `amount_local` and `exchange_rate`, and an allocation's
 * own `amount_local` — and a `RATIO` allocation carries the parts it was split
 * by. Those are read as hints only (`LocalMoney`, `parts`): `import-shape.ts`
 * writes them when they reproduce the figures exactly, so nothing here can
 * refuse over one.
 */

/** A repayment between two members rather than something that cost money. */
const BALANCE = "BALANCE";

interface TricountOptions {
  /** `YYYY-MM-DD` to a timestamp, as `readCsvGroup` takes it. */
  dayToTimestamp: (day: string) => number;
}

/** One entry, already dug out of its wrapper and with nothing read off it yet. */
interface RawEntry {
  /** 1-based position in the tricount, so a `PlannedEntry` has a `line` like any other. */
  line: number;
  description: string;
  category: string;
  date: string;
  balance: boolean;
  value: string;
  currency: string;
  owner: string;
  /** `DELETED` for an entry somebody removed, which the app no longer counts. */
  status: string;
  /** What was spent, when that was another currency: `amount_local`. */
  localValue: string;
  localCurrency: string;
  exchangeRate: string;
  /** name -> the allocation's own `amount.value`, still as the tricount wrote it. */
  allocations: RawAllocation[];
}

interface RawAllocation {
  name: string;
  value: string;
  currency: string;
  /** `AMOUNT` or `RATIO`; `share` is the ratio's parts. */
  type: string;
  share: unknown;
  localValue: string;
  localCurrency: string;
}

/** A value out of an unknown object, without asserting the object is one. */
function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null
    ? (from as Record<string, unknown>)[key]
    : undefined;
}

/** A string out of an unknown object, trimmed. Anything else reads as absent. */
function str(from: unknown, key: string): string {
  const found = field(from, key);
  return typeof found === "string" ? found.trim() : "";
}

/**
 * The name on a membership. `display_name` is what other exporters read; the
 * pointer's name is only a fallback.
 */
function memberName(wrapper: unknown): string {
  const member = field(wrapper, "RegistryMembershipNonUser") ?? wrapper;
  const alias = field(member, "alias");
  return str(alias, "display_name") || str(field(alias, "pointer"), "name");
}

/** The `Registry` out of whatever the endpoint answered with. */
function registryOf(payload: unknown): unknown {
  const direct = field(payload, "Registry");
  if (direct) return direct;
  const response = field(payload, "Response");
  if (Array.isArray(response)) {
    for (const item of response) {
      const found = field(item, "Registry");
      if (found) return found;
    }
  }
  // A renamed, deleted or private tricount answers with an Error array; same
  // refusal, and the sentence says to check the link.
  return undefined;
}

/**
 * Read a tricount payload into a plan, or throw an `ImportError` naming the
 * entry: a ledger missing one entry balances to something unaccountable.
 */
export function readTricount(payload: unknown, { dayToTimestamp }: TricountOptions): ImportPlan {
  const registry = registryOf(payload);
  if (!registry) throw new ImportError("not-tricount", "no Registry in the payload");

  // A removed entry is still listed, and the app counts it nowhere.
  const raw = readEntries(registry).filter((entry) => entry.status !== "DELETED");
  if (raw.length === 0) throw new ImportError("no-entries", "the tricount is empty");
  const currency = readCurrency(raw);
  const exp = exponentOf(currency);
  const members = readMembers(registry, raw);

  const entries: PlannedEntry[] = [];
  const transfers: PlannedTransfer[] = [];
  const dropped: { line: number; description: string }[] = [];
  /** The app's own arithmetic, kept beside the plan's — see the checksum above. */
  const stated: Record<string, number> = {};
  for (const name of members) stated[name] = 0;

  for (const entry of raw) {
    const value = amount(entry, entry.value, currency, exp);
    stated[entry.owner] = at(stated, entry.owner) - value;
    let allocated = 0;
    const shares: { name: string; minor: number }[] = [];
    for (const alloc of entry.allocations) {
      const share = amount(entry, alloc.value, currency, exp);
      stated[alloc.name] = at(stated, alloc.name) + share;
      allocated += share;
      if (share !== 0) shares.push({ name: alloc.name, minor: share });
    }

    // Carries no money, so dropping it keeps the checksum — what a zeroed-out
    // entry looks like.
    if (value === 0 && allocated === 0) {
      dropped.push({ line: entry.line, description: entry.description });
      continue;
    }
    if (allocated !== value) {
      throw new ImportError("tricount-split",
        `entry ${entry.line}: shares come to ${allocated}, the entry to ${value}`,
        undefined, `${named(entry)} — ${minorToDecimalString(allocated - value, currency)} out`);
    }

    // Money out is negative in Tricount. From here on it is positive, with the
    // direction in `kind`.
    const income = value > 0;
    const amountMinor = Math.abs(value);
    const day = readDay(entry);
    const occurredAt = dayToTimestamp(day);
    const clock = readClock(entry);
    const recordedAt = clock === undefined ? {} : { recordedAt: occurredAt + clock };

    if (entry.balance && !income && shares.length === 1) {
      const to = shares[0]!;
      if (to.minor === -amountMinor && to.name !== entry.owner) {
        const local = localOf(entry, false);
        transfers.push({
          from: entry.owner,
          to: to.name,
          amountMinor,
          note: entry.description === "" ? null : entry.description,
          ...(local ? { local: { currency: local.currency, amountMinor: local.amountMinor, rate: local.rate } } : {}),
          day,
          occurredAt,
          ...recordedAt,
          line: entry.line,
        });
        continue;
      }
    }

    const owed: Record<string, number> = {};
    for (const share of shares) {
      const held = income ? share.minor : -share.minor;
      if (held < 0) {
        throw new ImportError("tricount-split",
          `entry ${entry.line}: ${share.name} owes ${held}`,
          undefined, `${named(entry)} — ${minorToDecimalString(held, currency)} for ${share.name}`);
      }
      // Summed: a tricount can list one person twice on one entry.
      owed[share.name] = at(owed, share.name) + held;
    }

    const local = localOf(entry, income);
    const parts = partsOf(entry);
    entries.push({
      ...(local ? { local } : {}),
      ...(parts ? { parts } : {}),
      kind: income ? "income" : "expense",
      description: entry.description,
      // Free text, verbatim. Tricount's default reads as nothing, like `General`.
      categoryId: entry.category === "" || /^(general|uncategori[sz]ed)$/i.test(entry.category)
        ? null : entry.category,
      day,
      occurredAt,
      ...recordedAt,
      amountMinor,
      paid: { [entry.owner]: amountMinor },
      owed,
      line: entry.line,
    });
  }

  if (entries.length === 0 && transfers.length === 0) {
    throw new ImportError("no-entries", "nothing to import");
  }

  const plan: ImportPlan = {
    source: "tricount",
    title: str(registry, "title"),
    currency,
    members,
    entries,
    transfers,
    dropped,
    stated,
  };
  checkStated(plan);
  return plan;
}

/** Every entry, unwrapped, with nothing parsed. Order is the tricount's own. */
function readEntries(registry: unknown): RawEntry[] {
  const all = field(registry, "all_registry_entry");
  if (!Array.isArray(all)) {
    throw new ImportError("not-tricount", "the Registry has no all_registry_entry");
  }
  return all.map((wrapper, i) => {
    const entry = field(wrapper, "RegistryEntry") ?? wrapper;
    const allocations = field(entry, "allocations");
    return {
      line: i + 1,
      description: str(entry, "description"),
      category: str(entry, "category"),
      date: str(entry, "date"),
      balance: str(entry, "type_transaction").toUpperCase() === BALANCE,
      status: str(entry, "status").toUpperCase(),
      value: str(field(entry, "amount"), "value"),
      currency: str(field(entry, "amount"), "currency"),
      localValue: str(field(entry, "amount_local"), "value"),
      localCurrency: str(field(entry, "amount_local"), "currency").toUpperCase(),
      exchangeRate: str(entry, "exchange_rate"),
      owner: memberName(field(entry, "membership_owned")),
      allocations: (Array.isArray(allocations) ? allocations : []).map((alloc): RawAllocation => ({
        name: memberName(field(alloc, "membership")),
        value: str(field(alloc, "amount"), "value"),
        currency: str(field(alloc, "amount"), "currency"),
        type: str(alloc, "type").toUpperCase(),
        share: field(alloc, "share_ratio"),
        localValue: str(field(alloc, "amount_local"), "value"),
        localCurrency: str(field(alloc, "amount_local"), "currency").toUpperCase(),
      })),
    };
  });
}

/**
 * The one currency. Balances are stated in the base only, with rates we
 * aren't given, so a mixed tricount is refused like a mixed CSV.
 */
function readCurrency(raw: readonly RawEntry[]): CurrencyCode {
  return oneCurrency(raw.flatMap((entry) =>
    [entry.currency, ...entry.allocations.map((a) => a.currency)]
      .map((code) => ({ code: code.toUpperCase() }))));
}

/**
 * Everybody with a balance: the memberships in order, then anyone an entry
 * names who isn't among them — an entry can outlive the person's membership,
 * and dropping them fails the checksum unhelpfully.
 */
function readMembers(registry: unknown, raw: readonly RawEntry[]): string[] {
  const memberships = field(registry, "memberships");
  const names = (Array.isArray(memberships) ? memberships : []).map(memberName);
  for (const entry of raw) {
    // Keep the blank so the refusal below fires, rather than an entry whose
    // payer is nobody failing the checksum later.
    for (const name of [entry.owner, ...entry.allocations.map((a) => a.name)]) {
      if (!names.includes(name)) names.push(name);
    }
  }

  checkMemberNames(names);
  return names;
}

/**
 * What the entry was spent as, when that was another currency, or undefined.
 * Anything unreadable is no hint rather than a refusal: the base figures
 * already import. Shares only when every allocation states one that adds up.
 */
function localOf(entry: RawEntry, income: boolean): LocalMoney | undefined {
  const currency = entry.localCurrency;
  if (!isCurrencyCode(currency)) return undefined;
  const minor = hintMinor(entry.localValue, currency);
  if (minor === undefined || minor === 0) return undefined;
  const local: LocalMoney = { currency, amountMinor: Math.abs(minor), rate: entry.exchangeRate || null };

  const owed: Record<string, number> = {};
  for (const alloc of entry.allocations) {
    const share = alloc.localCurrency === currency ? hintMinor(alloc.localValue, currency) : undefined;
    if (share === undefined) return local;
    const held = income ? share : -share;
    if (held < 0) return local;
    if (held !== 0) owed[alloc.name] = at(owed, alloc.name) + held;
  }
  const total = Object.values(owed).reduce((a, b) => a + b, 0);
  return total === local.amountMinor ? { ...local, owed } : local;
}

/** One hint's figure, or undefined when it isn't a figure in that currency. */
function hintMinor(value: string, currency: CurrencyCode): number | undefined {
  if (value === "") return undefined;
  try {
    return strictMinor(value, currency, exponentOf(currency), () => new ImportError("tricount-amount", value));
  } catch {
    return undefined;
  }
}

/**
 * The parts a `RATIO` split was made by: name -> positive whole parts, from
 * every allocation that holds money. Undefined unless all of them are ratios.
 */
function partsOf(entry: RawEntry): Record<string, number> | undefined {
  const parts: Record<string, number> = {};
  let any = false;
  for (const alloc of entry.allocations) {
    if (/^-?0*(\.0*)?$/.test(alloc.value)) continue;
    if (alloc.type !== "RATIO") return undefined;
    const share = typeof alloc.share === "string" ? Number(alloc.share) : alloc.share;
    if (typeof share !== "number" || !Number.isSafeInteger(share) || share <= 0) return undefined;
    parts[alloc.name] = at(parts, alloc.name) + share;
    any = true;
  }
  return any ? parts : undefined;
}

/** An entry as a person would recognise it in the app, for a refusal to name. */
function named(entry: RawEntry): string {
  return entry.description === "" ? `entry ${entry.line}` : `“${entry.description}”`;
}

/** One figure. Absent is zero; anything else unreadable refuses the tricount. */
function amount(entry: RawEntry, value: string, currency: CurrencyCode, exp: number): number {
  return strictMinor(value, currency, exp, (why) => why === "unreadable"
    ? new ImportError("tricount-amount", `entry ${entry.line}: ${value} is not an amount`,
      undefined, `${named(entry)} — ${value}`)
    : new ImportError("tricount-amount", `entry ${entry.line}: ${value} is finer than ${currency}`,
      undefined, `${named(entry)} — ${value} in ${currency}`));
}

/**
 * The entry's day: the head of `2026-04-11 18:22:05.000000` (a `T` is
 * accepted too). Never guesses — the alternative files a trip under today.
 */
function readDay(entry: RawEntry): string {
  const head = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(entry.date)?.[1];
  if (!head || !isRealDay(head)) {
    throw new ImportError("tricount-date", `entry ${entry.line}: ${entry.date} is not a date`,
      undefined, `${named(entry)} — ${entry.date || "no date"}`);
  }
  return head;
}

/**
 * The time of day after the date, as milliseconds into it, or undefined when
 * there is none. Only ever an order: Tricount lists a day by it, latest first,
 * and every import otherwise stamps one instant on all of them, leaving a day
 * in id order. Read as the phone's own clock, like the day before it.
 */
function readClock(entry: RawEntry): number | undefined {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(entry.date);
  if (!m) return undefined;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
  if (h > 23 || min > 59 || s > 59) return undefined;
  const ms = Number((m[4] ?? "").slice(0, 3).padEnd(3, "0"));
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}
