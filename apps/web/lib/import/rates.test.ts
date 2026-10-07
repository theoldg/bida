import { readCsvGroup } from "@bida/core";
import { describe, expect, it } from "vitest";
import { RateOfflineError } from "../rates";
import { lookUpRates, RatesUnavailableError } from "./rates";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** EUR the group's (most rows), MAD on three days, USD on one. */
const plan = readCsvGroup([
  ["Date", "Description", "Category", "Cost", "Currency", "Ana", "Bo"],
  ["2026-04-01", "Dinner", "General", "30.00", "EUR", "15.00", "-15.00"],
  ["2026-04-02", "Lunch", "General", "30.00", "EUR", "15.00", "-15.00"],
  ["2026-04-03", "Bus", "General", "4.00", "EUR", "2.00", "-2.00"],
  ["2026-04-04", "Bus", "General", "4.00", "EUR", "2.00", "-2.00"],
  ["2026-04-03", "Tea", "General", "10.00", "MAD", "5.00", "-5.00"],
  ["2026-04-05", "Tea", "General", "10.00", "MAD", "5.00", "-5.00"],
  ["2026-04-09", "Tea", "General", "10.00", "MAD", "5.00", "-5.00"],
  ["2026-04-09", "Gum", "General", "2.00", "USD", "1.00", "-1.00"],
  ["2026-09-18", "Total balance", " ", " ", "EUR", "34.00", "-34.00"],
  ["2026-09-18", "Total balance", " ", " ", "MAD", "15.00", "-15.00"],
  ["2026-09-18", "Total balance", " ", " ", "USD", "1.00", "-1.00"],
], { dayToTimestamp: day });

describe("lookUpRates", () => {
  it("asks once per currency per day, against the group's currency", async () => {
    const asked: string[] = [];
    const rateFor = await lookUpRates(plan, async (from, to, d) => {
      asked.push(`${from}>${to} ${d}`);
      return { rate: "0.09", asOf: d ?? null };
    });
    expect(asked.sort()).toEqual([
      "MAD>EUR 2026-04-03", "MAD>EUR 2026-04-05", "MAD>EUR 2026-04-09", "USD>EUR 2026-04-09",
    ]);
    expect(rateFor("MAD", "2026-04-05")).toEqual({ rate: "0.09", source: "fetched" });
  });

  it("lends a day the feed missed the nearest day it answered, the earlier on a tie", async () => {
    const rateFor = await lookUpRates(plan, async (from, _to, d) => {
      if (from === "MAD" && d === "2026-04-05") throw new Error("no rate");
      return { rate: d === "2026-04-03" ? "0.091" : "0.093", asOf: null };
    });
    // 04-03 and 04-09 are 2 and 4 days off.
    expect(rateFor("MAD", "2026-04-05")).toEqual({ rate: "0.091", source: "copied" });
  });

  it("stops the import when a currency has no rate at all, naming it", async () => {
    const err = await lookUpRates(plan, async (from) => {
      if (from === "USD") throw new Error("no rate");
      return { rate: "0.09", asOf: null };
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RatesUnavailableError);
    expect((err as RatesUnavailableError).currencies).toEqual(["USD"]);
    expect((err as RatesUnavailableError).offline).toBe(false);
  });

  it("says when it was the phone that couldn't reach anything", async () => {
    const err = await lookUpRates(plan, async () => {
      throw new RateOfflineError("offline");
    }).catch((e: unknown) => e);
    expect((err as RatesUnavailableError).offline).toBe(true);
    expect((err as RatesUnavailableError).currencies.sort()).toEqual(["MAD", "USD"]);
  });
});
