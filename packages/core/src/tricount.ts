import {
  at, checkStated, ImportError,
  type ImportPlan, type PlannedEntry, type PlannedTransfer,
} from "./import.js";
import { exponentOf, isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";

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
  /** name -> the allocation's own `amount.value`, still as the tricount wrote it. */
  allocations: { name: string; value: string; currency: string }[];
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

  const raw = readEntries(registry);
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

    if (entry.balance && !income && shares.length === 1) {
      const to = shares[0]!;
      if (to.minor === -amountMinor && to.name !== entry.owner) {
        transfers.push({
          from: entry.owner,
          to: to.name,
          amountMinor,
          note: entry.description === "" ? null : entry.description,
          day,
          occurredAt,
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

    entries.push({
      kind: income ? "income" : "expense",
      description: entry.description,
      // Free text, verbatim. Tricount's default reads as nothing, like `General`.
      categoryId: entry.category === "" || /^(general|uncategori[sz]ed)$/i.test(entry.category)
        ? null : entry.category,
      day,
      occurredAt,
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
      value: str(field(entry, "amount"), "value"),
      currency: str(field(entry, "amount"), "currency"),
      owner: memberName(field(entry, "membership_owned")),
      allocations: (Array.isArray(allocations) ? allocations : []).map((alloc) => ({
        name: memberName(field(alloc, "membership")),
        value: str(field(alloc, "amount"), "value"),
        currency: str(field(alloc, "amount"), "currency"),
      })),
    };
  });
}

/**
 * The one currency. Balances are stated in the base only, with rates we
 * aren't given, so a mixed tricount is refused like a mixed CSV.
 */
function readCurrency(raw: readonly RawEntry[]): CurrencyCode {
  const found = new Set<string>();
  for (const entry of raw) {
    for (const code of [entry.currency, ...entry.allocations.map((a) => a.currency)]) {
      if (code === "") continue;
      const upper = code.toUpperCase();
      if (!isCurrencyCode(upper)) {
        throw new ImportError("unknown-currency", `${upper} is not a currency`, undefined, upper);
      }
      found.add(upper);
    }
  }
  const codes = [...found].sort();
  if (codes.length === 0) throw new ImportError("unknown-currency", "nothing states a currency");
  if (codes.length > 1) {
    throw new ImportError("mixed-currency", `mixes ${codes.join(",")}`, undefined, codes.join(", "));
  }
  return codes[0]!;
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

  if (names.length === 0) throw new ImportError("no-members", "no memberships");
  if (names.some((n) => n === "")) {
    throw new ImportError("blank-member", "a membership has no name");
  }
  // Refused as in a CSV header (`readHeader`): `__proto__` vanishes, and two
  // people of one name share one balance.
  const reserved = names.find((n) => n === "__proto__");
  if (reserved !== undefined) {
    throw new ImportError("bad-member-name", `a member is called ${reserved}`, undefined, reserved);
  }
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new ImportError("duplicate-member", `two members called ${name}`, undefined, name);
    }
    seen.add(key);
  }
  return names;
}

/** An entry as a person would recognise it in the app, for a refusal to name. */
function named(entry: RawEntry): string {
  return entry.description === "" ? `entry ${entry.line}` : `“${entry.description}”`;
}

/** One figure. Absent is zero; anything else unreadable refuses the tricount. */
function amount(entry: RawEntry, value: string, currency: CurrencyCode, exp: number): number {
  if (value === "") return 0;
  let minor: number;
  try {
    minor = parseMinor(value, currency);
  } catch {
    throw new ImportError("tricount-amount", `entry ${entry.line}: ${value} is not an amount`,
      undefined, `${named(entry)} — ${value}`);
  }
  // As in `import.ts`: extra decimals mean the wrong currency, and rounding hides it.
  const frac = value.replace(/\s/g, "").replace(",", ".").split(".")[1] ?? "";
  if (frac.length > exp) {
    throw new ImportError("tricount-amount", `entry ${entry.line}: ${value} is finer than ${currency}`,
      undefined, `${named(entry)} — ${value} in ${currency}`);
  }
  return minor;
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

/** `2026-02-30` parses as a date and is not one. */
function isRealDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}
