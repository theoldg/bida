import {
  at, checkStated, ImportError,
  type ImportPlan, type PlannedEntry, type PlannedTransfer,
} from "./import.js";
import { exponentOf, isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";

/**
 * A tricount read into the same **plan** `import.ts` hands back from a CSV, so
 * everything downstream — the readout, the who-picker, the one `appendOps`
 * batch — is untouched. Nothing here writes anything, and nothing here fetches:
 * the JSON arrives from `apps/web/lib/import/tricount.ts` through the Worker
 * (docs/data-model.md#reading-a-tricount-back).
 *
 * ## What the shape is
 *
 * Tricount is bunq's, and a group is a `Registry`: a list of `memberships` and
 * a list of `all_registry_entry`, each entry carrying an `amount`, the
 * membership that `owned` it — the person whose pocket the money left — and
 * `allocations` saying whose it was. Every figure is **signed from the
 * group's side**: an expense is negative all the way down, an income positive.
 * One line converts that to ours and the rest of this file reads in the
 * positive minor units [CLAUDE.md](../../../CLAUDE.md#non-negotiables) insists on.
 *
 * ## Why this inverts where a CSV does not
 *
 * The spreadsheet's hard case — one cell holding `paid − owed`, from which no
 * arithmetic recovers both ([import.ts](./import.ts)) — does not arise: an
 * entry states its payer and each share separately, so an expense comes back
 * exactly as it was entered. Two things still do not survive:
 *
 * - **One payer per entry.** `membership_owned` is a single membership, so a
 *   tricount split across several payers arrives as one. Nothing observed in
 *   the wild does that; if one does, its balances still land, since the
 *   checksum is what decides whether the import stands.
 * - **A repayment is a transfer only when it has the shape** — `BALANCE`
 *   *and* exactly one person on the receiving end. Anything else is read as an
 *   expense, which is the reading that loses nothing, the same ruling
 *   `asTransfer` makes about the `Payment` token.
 *
 * ## The checksum
 *
 * A tricount has no foot row, so one is computed — from the raw figures, by
 * **the route the app itself uses** (allocations minus what you owned), which
 * is not the route the plan takes. That is what makes it worth checking: it
 * catches a transfer read backwards, an income unflipped and a payer wrongly
 * apportioned, because none of those change the raw sums and all of them
 * change the plan's.
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
 * The name on a membership wrapper. `display_name` is what the app shows and
 * what the other exporters read; the pointer's name is the same string on
 * every payload seen, and is taken only when the first is missing.
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
  // A tricount that has been renamed, deleted or made private answers with an
  // Error array rather than a Registry, and that is the same refusal here: we
  // have no registry to read, and the sentence says the link is the thing to
  // check.
  return undefined;
}

/**
 * Read a tricount payload into a plan, or throw an `ImportError`. Every
 * refusal here is whole-tricount and names the entry rather than a line
 * number, for the reason the CSV reader names the line: a ledger missing one
 * entry balances to something nobody can account for.
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

    // Carries no money, so it adds nothing to anybody's balance and the
    // checksum survives dropping it — the one row a CSV drops, for the one
    // reason. A tricount writes these as an entry somebody zeroed out.
    if (value === 0 && allocated === 0) {
      dropped.push({ line: entry.line, description: entry.description });
      continue;
    }
    if (allocated !== value) {
      throw new ImportError("tricount-split",
        `entry ${entry.line}: shares come to ${allocated}, the entry to ${value}`,
        undefined, `${named(entry)} — ${minorToDecimalString(allocated - value, currency)} out`);
    }

    // Tricount signs everything from the group's side: money out is negative.
    // From here down it is ours — positive, with the direction in `kind`.
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
      // Summed rather than assigned: a tricount can list one person twice on
      // one entry, and `owed` is the split the group will be given.
      owed[share.name] = at(owed, share.name) + held;
    }

    entries.push({
      kind: income ? "income" : "expense",
      description: entry.description,
      // Free text on the entry here as in a CSV, so it comes back verbatim.
      // Tricount's own default reads as a category nobody picked, and lands
      // as nothing for the same reason `General` does.
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
 * The one currency. A tricount can hold several, priced against each other by
 * rates we are not given, and its balances are stated in the base alone — so
 * the same refusal a mixed CSV gets, for the same reason: what we would import
 * is a ledger nothing can check.
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
 * Everybody with a balance: the memberships, in the tricount's own order, and
 * then anybody an entry names who is not among them. The second half is not
 * paranoia — a membership list is what the app shows, and an entry can outlive
 * the person's row in it, so reading only the list would drop money on the
 * floor and fail the checksum three steps later with nothing useful to say.
 */
function readMembers(registry: unknown, raw: readonly RawEntry[]): string[] {
  const memberships = field(registry, "memberships");
  const names = (Array.isArray(memberships) ? memberships : []).map(memberName);
  for (const entry of raw) {
    // The blank is pushed like any other name, so the refusal below fires:
    // skipping it here would leave an entry whose payer is nobody, and the
    // checksum would catch that three steps later with nothing to say.
    for (const name of [entry.owner, ...entry.allocations.map((a) => a.name)]) {
      if (!names.includes(name)) names.push(name);
    }
  }

  if (names.length === 0) throw new ImportError("no-members", "no memberships");
  if (names.some((n) => n === "")) {
    throw new ImportError("blank-member", "a membership has no name");
  }
  // The same two names a CSV header refuses, for the same two reasons:
  // `__proto__` is stored nowhere and vanishes, and two people of one name
  // have one balance between them. See `readHeader`.
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
  // `parseMinor` rounds excess precision away, which is right for a keyboard
  // and wrong here: more decimals than the currency has means we are reading
  // the wrong currency, and rounding hides it. Same ruling as `amount` in
  // `import.ts`.
  const frac = value.replace(/\s/g, "").replace(",", ".").split(".")[1] ?? "";
  if (frac.length > exp) {
    throw new ImportError("tricount-amount", `entry ${entry.line}: ${value} is finer than ${currency}`,
      undefined, `${named(entry)} — ${value} in ${currency}`);
  }
  return minor;
}

/**
 * The day an entry happened. The field is a timestamp with a space in it
 * (`2026-04-11 18:22:05.000000`) and the date is its head; a `T` in place of
 * the space is accepted for the same reason the CSV reader accepts CRLF.
 * Nothing guesses at a day it cannot see — the alternative is filing somebody's
 * whole trip under today.
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
