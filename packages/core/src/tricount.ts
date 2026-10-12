import {
  at, checkMemberNames, checkStated, ImportError, isRealDay, oneCurrency, strictMinor,
  type ImportPlan, type LocalMoney, type PlannedEntry, type PlannedTransfer,
} from "./import.js";
import { exponentOf, isCurrencyCode, minorToDecimalString, type CurrencyCode } from "./money.js";

/**
 * A tricount read into the same plan `import.ts` returns from a CSV
 * (docs/import-export.md#reading-a-tricount-back). Every figure is signed from
 * the group's side, expenses negative, and made positive in one place.
 *
 * Unlike a CSV this inverts exactly. With no foot row, the checksum is computed
 * from the raw figures the app's own way, so it catches a transfer backwards or a
 * wrong payer. Foreign amounts and ratio parts are hints only.
 */

const BALANCE = "BALANCE";

interface TricountOptions {
  dayToTimestamp: (day: string) => number;
}

interface RawEntry {
  line: number;
  description: string;
  category: string;
  date: string;
  balance: boolean;
  value: string;
  currency: string;
  owner: string;
  status: string;
  localValue: string;
  localCurrency: string;
  exchangeRate: string;
  allocations: RawAllocation[];
}

interface RawAllocation {
  name: string;
  value: string;
  currency: string;
  type: string;
  share: unknown;
  localValue: string;
  localCurrency: string;
}

function field(from: unknown, key: string): unknown {
  return typeof from === "object" && from !== null
    ? (from as Record<string, unknown>)[key]
    : undefined;
}

function str(from: unknown, key: string): string {
  const found = field(from, key);
  return typeof found === "string" ? found.trim() : "";
}

/**
 * `display_name` is what other exporters read; the pointer's name is a fallback.
 */
function memberName(wrapper: unknown): string {
  const member = field(wrapper, "RegistryMembershipNonUser") ?? wrapper;
  const alias = field(member, "alias");
  return str(alias, "display_name") || str(field(alias, "pointer"), "name");
}

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
  // A renamed, deleted or private tricount answers with an Error array.
  return undefined;
}

/** A ledger missing one entry balances to something unaccountable. */
export function readTricount(payload: unknown, { dayToTimestamp }: TricountOptions): ImportPlan {
  const registry = registryOf(payload);
  if (!registry) throw new ImportError("not-tricount", "no Registry in the payload");

  const raw = readEntries(registry).filter((entry) => entry.status !== "DELETED");
  if (raw.length === 0) throw new ImportError("no-entries", "the tricount is empty");
  const currency = readCurrency(raw);
  const exp = exponentOf(currency);
  const members = readMembers(registry, raw);

  const entries: PlannedEntry[] = [];
  const transfers: PlannedTransfer[] = [];
  const dropped: { line: number; description: string }[] = [];
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

    if (value === 0 && allocated === 0) {
      dropped.push({ line: entry.line, description: entry.description });
      continue;
    }
    if (allocated !== value) {
      throw new ImportError("tricount-split",
        `entry ${entry.line}: shares come to ${allocated}, the entry to ${value}`,
        undefined, `${named(entry)} — ${minorToDecimalString(allocated - value, currency)} out`);
    }

    // Money out is negative in Tricount; from here on the direction is in `kind`.
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
      // Tricount's default reads as nothing, like `General`.
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

/** Balances are stated in the base only, with rates we aren't given. */
function readCurrency(raw: readonly RawEntry[]): CurrencyCode {
  return oneCurrency(raw.flatMap((entry) =>
    [entry.currency, ...entry.allocations.map((a) => a.currency)]
      .map((code) => ({ code: code.toUpperCase() }))));
}

/**
 * Anyone an entry names who isn't a member too: an entry can outlive the
 * membership.
 */
function readMembers(registry: unknown, raw: readonly RawEntry[]): string[] {
  const memberships = field(registry, "memberships");
  const names = (Array.isArray(memberships) ? memberships : []).map(memberName);
  for (const entry of raw) {
    // Keep the blank so the refusal fires, not a checksum later.
    for (const name of [entry.owner, ...entry.allocations.map((a) => a.name)]) {
      if (!names.includes(name)) names.push(name);
    }
  }

  checkMemberNames(names);
  return names;
}

/**
 * Unreadable is no hint rather than a refusal: the base figures already import.
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

function hintMinor(value: string, currency: CurrencyCode): number | undefined {
  if (value === "") return undefined;
  try {
    return strictMinor(value, currency, exponentOf(currency), () => new ImportError("tricount-amount", value));
  } catch {
    return undefined;
  }
}

/** Undefined unless every allocation holding money is a ratio. */
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

function named(entry: RawEntry): string {
  return entry.description === "" ? `entry ${entry.line}` : `“${entry.description}”`;
}

function amount(entry: RawEntry, value: string, currency: CurrencyCode, exp: number): number {
  return strictMinor(value, currency, exp, (why) => why === "unreadable"
    ? new ImportError("tricount-amount", `entry ${entry.line}: ${value} is not an amount`,
      undefined, `${named(entry)} — ${value}`)
    : new ImportError("tricount-amount", `entry ${entry.line}: ${value} is finer than ${currency}`,
      undefined, `${named(entry)} — ${value} in ${currency}`));
}

/** Never guesses: the alternative files a trip under today. */
function readDay(entry: RawEntry): string {
  const head = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(entry.date)?.[1];
  if (!head || !isRealDay(head)) {
    throw new ImportError("tricount-date", `entry ${entry.line}: ${entry.date} is not a date`,
      undefined, `${named(entry)} — ${entry.date || "no date"}`);
  }
  return head;
}

/** Only ever an order within a day, read as the phone's own clock. */
function readClock(entry: RawEntry): number | undefined {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(entry.date);
  if (!m) return undefined;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
  if (h > 23 || min > 59 || s > 59) return undefined;
  const ms = Number((m[4] ?? "").slice(0, 3).padEnd(3, "0"));
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}
