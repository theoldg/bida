import { describe, expect, it } from "vitest";
import { ImportError } from "./import.js";
import { readTricount } from "./tricount.js";

/**
 * The reader against the shape bunq actually answers with. The fixtures below
 * are that shape trimmed to the fields read — the payload carries avatars,
 * attachments and ids none of this looks at — and the arithmetic is the part
 * that matters: every test that builds a plan also asserts the balances,
 * because the checksum is what decides whether an import stands.
 */

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const read = (payload: unknown) => readTricount(payload, { dayToTimestamp: at });

function member(name: string) {
  return { RegistryMembershipNonUser: { id: 1, alias: { display_name: name } } };
}

interface EntryInput {
  description?: string;
  category?: string;
  date?: string;
  type?: string;
  /** The entry's own figure, signed the way tricount signs it. */
  value: string;
  currency?: string;
  owner: string;
  /** name -> the allocation's figure, signed the same way. */
  shares: Record<string, string>;
}

function entry(input: EntryInput) {
  const currency = input.currency ?? "EUR";
  return {
    RegistryEntry: {
      description: input.description ?? "Dinner",
      category: input.category ?? "GENERAL",
      date: input.date ?? "2026-04-11 18:22:05.000000",
      type_transaction: input.type ?? "NORMAL",
      amount: { value: input.value, currency },
      membership_owned: member(input.owner),
      allocations: Object.entries(input.shares).map(([name, value]) => ({
        amount: { value, currency },
        membership: member(name),
      })),
    },
  };
}

function tricount(names: readonly string[], entries: readonly unknown[], title = "Lisbon") {
  return {
    Response: [
      { Registry: { title, memberships: names.map(member), all_registry_entry: entries } },
    ],
  };
}

/** What the group owes whom, from the plan the way `checkStated` computes it. */
function balances(plan: ReturnType<typeof read>): Record<string, number> {
  return plan.stated;
}

function refusal(payload: unknown): ImportError {
  try {
    read(payload);
  } catch (err) {
    if (err instanceof ImportError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("readTricount", () => {
  it("reads an expense one person paid and three split", () => {
    const plan = read(tricount(["Ana", "Bo", "Cy"], [
      entry({ value: "-30.00", owner: "Ana", shares: { Ana: "-10.00", Bo: "-10.00", Cy: "-10.00" } }),
    ]));

    expect(plan.title).toBe("Lisbon");
    expect(plan.currency).toBe("EUR");
    expect(plan.members).toEqual(["Ana", "Bo", "Cy"]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.transfers).toEqual([]);
    const only = plan.entries[0]!;
    expect(only.kind).toBe("expense");
    expect(only.amountMinor).toBe(3000);
    expect(only.paid).toEqual({ Ana: 3000 });
    expect(only.owed).toEqual({ Ana: 1000, Bo: 1000, Cy: 1000 });
    expect(only.day).toBe("2026-04-11");
    expect(only.occurredAt).toBe(at("2026-04-11"));
    // The tricount default is a category nobody picked, like `General` in a CSV.
    expect(only.categoryId).toBeNull();
    expect(balances(plan)).toEqual({ Ana: 2000, Bo: -1000, Cy: -1000 });
  });

  it("leaves out the people an entry does not touch", () => {
    const plan = read(tricount(["Ana", "Bo", "Cy"], [
      entry({ value: "-20.00", owner: "Ana", shares: { Bo: "-20.00", Cy: "0.00" } }),
    ]));
    expect(plan.entries[0]!.owed).toEqual({ Bo: 2000 });
    expect(balances(plan)).toEqual({ Ana: 2000, Bo: -2000, Cy: 0 });
  });

  it("reads a repayment as a transfer, the way round that clears the debt", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ value: "-40.00", owner: "Ana", shares: { Ana: "-20.00", Bo: "-20.00" } }),
      entry({
        type: "BALANCE", description: "", value: "-20.00", owner: "Bo", shares: { Ana: "-20.00" },
      }),
    ]));

    expect(plan.entries).toHaveLength(1);
    expect(plan.transfers).toEqual([{
      from: "Bo",
      to: "Ana",
      amountMinor: 2000,
      note: null,
      day: "2026-04-11",
      occurredAt: at("2026-04-11"),
      line: 2,
    }]);
    // Which is the whole point of getting the direction right.
    expect(balances(plan)).toEqual({ Ana: 0, Bo: 0 });
  });

  it("keeps a repayment's note when somebody wrote one", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({
        type: "BALANCE", description: "cash at the airport",
        value: "-5.00", owner: "Bo", shares: { Ana: "-5.00" },
      }),
    ]));
    expect(plan.transfers[0]!.note).toBe("cash at the airport");
  });

  it("reads a BALANCE without the shape as an expense rather than guessing", () => {
    // Two people on the receiving end is not a transfer between two people,
    // and reading it as an expense loses nothing.
    const plan = read(tricount(["Ana", "Bo", "Cy"], [
      entry({
        type: "BALANCE", value: "-10.00", owner: "Ana", shares: { Bo: "-6.00", Cy: "-4.00" },
      }),
    ]));
    expect(plan.transfers).toEqual([]);
    expect(plan.entries[0]!.owed).toEqual({ Bo: 600, Cy: 400 });
    expect(balances(plan)).toEqual({ Ana: 1000, Bo: -600, Cy: -400 });
  });

  it("does not make a transfer out of a repayment to oneself", () => {
    // A transfer from Ana to Ana is a no-op the ledger would still print, so
    // it comes back as the expense the shape rules default to, and either
    // reading leaves the balances where they were.
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ type: "BALANCE", value: "-5.00", owner: "Ana", shares: { Ana: "-5.00" } }),
    ]));
    expect(plan.transfers).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(balances(plan)).toEqual({ Ana: 0, Bo: 0 });
  });

  it("flips an income, which runs the other way all the way down", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ description: "Deposit back", value: "100.00", owner: "Ana",
        shares: { Ana: "50.00", Bo: "50.00" } }),
    ]));
    const only = plan.entries[0]!;
    expect(only.kind).toBe("income");
    expect(only.amountMinor).toBe(10000);
    expect(only.paid).toEqual({ Ana: 10000 });
    expect(only.owed).toEqual({ Ana: 5000, Bo: 5000 });
    // Ana is holding money that is half Bo's.
    expect(balances(plan)).toEqual({ Ana: -5000, Bo: 5000 });
  });

  it("keeps a category somebody chose and drops the protocol ones", () => {
    const plan = read(tricount(["Ana"], [
      entry({ category: "Transport", value: "-1.00", owner: "Ana", shares: { Ana: "-1.00" } }),
      entry({ category: "uncategorized", value: "-2.00", owner: "Ana", shares: { Ana: "-2.00" } }),
      entry({ category: "", value: "-3.00", owner: "Ana", shares: { Ana: "-3.00" } }),
    ]));
    expect(plan.entries.map((e) => e.categoryId)).toEqual(["Transport", null, null]);
  });

  it("drops an entry carrying no money and keeps the checksum", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ description: "Nothing yet", value: "0.00", owner: "Ana", shares: {} }),
      entry({ value: "-8.00", owner: "Ana", shares: { Bo: "-8.00" } }),
    ]));
    expect(plan.dropped).toEqual([{ line: 1, description: "Nothing yet" }]);
    expect(plan.entries).toHaveLength(1);
    expect(balances(plan)).toEqual({ Ana: 800, Bo: -800 });
  });

  it("reads a member an entry names but the membership list has forgotten", () => {
    const plan = read(tricount(["Ana"], [
      entry({ value: "-9.00", owner: "Ana", shares: { Ana: "-3.00", Zoe: "-6.00" } }),
    ]));
    expect(plan.members).toEqual(["Ana", "Zoe"]);
    expect(balances(plan)).toEqual({ Ana: 600, Zoe: -600 });
  });

  it("takes the alias pointer's name when there is no display name", () => {
    const payload = {
      Response: [{
        Registry: {
          title: "T",
          memberships: [{ RegistryMembershipNonUser: { alias: { pointer: { name: "Ana" } } } }],
          all_registry_entry: [{
            RegistryEntry: {
              description: "x", category: "", date: "2026-01-02 00:00:00.000000",
              type_transaction: "NORMAL", amount: { value: "-1.00", currency: "EUR" },
              membership_owned: { RegistryMembershipNonUser: { alias: { pointer: { name: "Ana" } } } },
              allocations: [{
                amount: { value: "-1.00", currency: "EUR" },
                membership: { RegistryMembershipNonUser: { alias: { pointer: { name: "Ana" } } } },
              }],
            },
          }],
        },
      }],
    };
    expect(read(payload).members).toEqual(["Ana"]);
  });

  it("reads a zero-decimal currency in its own units", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ value: "-1000", currency: "JPY", owner: "Ana", shares: { Bo: "-1000" } }),
    ]));
    expect(plan.currency).toBe("JPY");
    expect(plan.entries[0]!.amountMinor).toBe(1000);
    expect(balances(plan)).toEqual({ Ana: 1000, Bo: -1000 });
  });

  it("reads a three-decimal currency in its own units", () => {
    const plan = read(tricount(["Ana", "Bo"], [
      entry({ value: "-1.500", currency: "BHD", owner: "Ana", shares: { Bo: "-1.500" } }),
    ]));
    expect(plan.entries[0]!.amountMinor).toBe(1500);
  });

  it("sums a person allocated twice on one entry", () => {
    // Two allocations, one person — the map `owed` is built on must add them
    // rather than let the second overwrite the first, or the entry's own
    // shares stop coming to what it cost.
    const twice = entry({ value: "-6.00", owner: "Ana", shares: { Bo: "-2.00" } });
    twice.RegistryEntry.allocations.push({
      amount: { value: "-4.00", currency: "EUR" },
      membership: member("Bo"),
    });
    const plan = read(tricount(["Ana", "Bo"], [twice]));
    expect(plan.entries[0]!.owed).toEqual({ Bo: 600 });
    expect(balances(plan)).toEqual({ Ana: 600, Bo: -600 });
  });

  it("accepts a date written with a T", () => {
    const plan = read(tricount(["Ana"], [
      entry({ date: "2026-04-11T18:22:05Z", value: "-1.00", owner: "Ana", shares: { Ana: "-1.00" } }),
    ]));
    expect(plan.entries[0]!.day).toBe("2026-04-11");
  });

  it("holds a hundred entries to the cent", () => {
    const names = ["Ana", "Bo", "Cy", "Di"];
    const entries = Array.from({ length: 100 }, (_, i) =>
      entry({
        description: `Day ${i}`,
        date: "2026-04-11 10:00:00.000000",
        value: "-40.00",
        owner: names[i % names.length]!,
        shares: Object.fromEntries(names.map((n) => [n, "-10.00"])),
      }));
    const plan = read(tricount(names, entries));
    expect(plan.entries).toHaveLength(100);
    // Everybody paid 25 of the 100 and owed all of them, so nobody is owed a thing.
    expect(balances(plan)).toEqual({ Ana: 0, Bo: 0, Cy: 0, Di: 0 });
  });
});

describe("readTricount refusals", () => {
  it("refuses something that isn't a tricount at all", () => {
    expect(refusal({ Response: [{ Error: [{ error_description: "nope" }] }] }).code)
      .toBe("not-tricount");
    expect(refusal("<html>").code).toBe("not-tricount");
    expect(refusal({ Response: [{ Registry: { title: "x" } }] }).code).toBe("not-tricount");
  });

  it("refuses an empty tricount", () => {
    expect(refusal(tricount(["Ana"], [])).code).toBe("no-entries");
  });

  it("refuses a tricount whose entries all carry nothing", () => {
    expect(refusal(tricount(["Ana"], [
      entry({ value: "0.00", owner: "Ana", shares: {} }),
    ])).code).toBe("no-entries");
  });

  it("refuses more than one currency, naming both", () => {
    const err = refusal(tricount(["Ana", "Bo"], [
      entry({ value: "-1.00", currency: "EUR", owner: "Ana", shares: { Bo: "-1.00" } }),
      entry({ value: "-1.00", currency: "USD", owner: "Ana", shares: { Bo: "-1.00" } }),
    ]));
    expect(err.code).toBe("mixed-currency");
    expect(err.detail).toBe("EUR, USD");
  });

  it("refuses a currency that isn't one", () => {
    const err = refusal(tricount(["Ana"], [
      entry({ value: "-1.00", currency: "EURO", owner: "Ana", shares: { Ana: "-1.00" } }),
    ]));
    expect(err.code).toBe("unknown-currency");
    expect(err.detail).toBe("EURO");
  });

  it("refuses two people of one name", () => {
    const err = refusal(tricount(["Ana", "ana"], [
      entry({ value: "-1.00", owner: "Ana", shares: { Ana: "-1.00" } }),
    ]));
    expect(err.code).toBe("duplicate-member");
    expect(err.detail).toBe("ana");
  });

  it("refuses a member with no name", () => {
    expect(refusal(tricount(["Ana", ""], [
      entry({ value: "-1.00", owner: "Ana", shares: { Ana: "-1.00" } }),
    ])).code).toBe("blank-member");
  });

  it("refuses an entry whose payer is nobody", () => {
    expect(refusal(tricount(["Ana"], [
      entry({ value: "-1.00", owner: "", shares: { Ana: "-1.00" } }),
    ])).code).toBe("blank-member");
  });

  it("refuses __proto__ as a name", () => {
    const err = refusal(tricount(["Ana", "__proto__"], [
      entry({ value: "-1.00", owner: "Ana", shares: { Ana: "-1.00" } }),
    ]));
    expect(err.code).toBe("bad-member-name");
    expect(err.detail).toBe("__proto__");
  });

  it("refuses an amount that is not a number, naming the entry", () => {
    const err = refusal(tricount(["Ana"], [
      entry({ description: "Ferry", value: "-1.00 EUR", owner: "Ana", shares: { Ana: "-1.00" } }),
    ]));
    expect(err.code).toBe("tricount-amount");
    expect(err.detail).toContain("Ferry");
  });

  it("refuses an amount finer than its currency, which means the wrong currency", () => {
    const err = refusal(tricount(["Ana"], [
      entry({ value: "-1.005", owner: "Ana", shares: { Ana: "-1.005" } }),
    ]));
    expect(err.code).toBe("tricount-amount");
  });

  it("refuses an entry with no readable date", () => {
    const err = refusal(tricount(["Ana"], [
      entry({ description: "Taxi", date: "11/04/2026", value: "-1.00", owner: "Ana",
        shares: { Ana: "-1.00" } }),
    ]));
    expect(err.code).toBe("tricount-date");
    expect(err.detail).toContain("Taxi");
  });

  it("refuses a day that is not one", () => {
    expect(refusal(tricount(["Ana"], [
      entry({ date: "2026-02-30 00:00:00.000000", value: "-1.00", owner: "Ana",
        shares: { Ana: "-1.00" } }),
    ])).code).toBe("tricount-date");
  });

  it("refuses an entry whose shares don't come to what it cost", () => {
    const err = refusal(tricount(["Ana", "Bo"], [
      entry({ description: "Hotel", value: "-30.00", owner: "Ana",
        shares: { Ana: "-10.00", Bo: "-10.00" } }),
    ]));
    expect(err.code).toBe("tricount-split");
    expect(err.detail).toContain("Hotel");
  });

  it("refuses a share that runs against its own entry", () => {
    const err = refusal(tricount(["Ana", "Bo"], [
      entry({ value: "-10.00", owner: "Ana", shares: { Ana: "-15.00", Bo: "5.00" } }),
    ]));
    expect(err.code).toBe("tricount-split");
  });
});
