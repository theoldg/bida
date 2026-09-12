import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkScan, normalizeScan, parseMinor, scanCurrency, type ScanProblem, type ScanResult } from "@bida/core";
import { parseScanResponse } from "./response";

/**
 * The canned receipts `pnpm drive`'s `receipt` command hands a phone
 * (`scripts/fixtures/receipts/`), checked against the code that will read
 * them.
 *
 * Each one claims, in `exercises`, which verdict it is there to produce. That
 * claim is the whole value of the fixture — a "mismatch" bill that quietly
 * starts adding up tests nothing, and says so nowhere. This is the only thing
 * standing between the set and that: the inline fixture these replaced had
 * drifted to a field `ScanResult` has never had, undetected.
 */
const DIR = fileURLToPath(new URL("../../../../scripts/fixtures/receipts/", import.meta.url));

interface Fixture {
  note: string;
  exercises: "ok" | "rejected" | "busy" | ScanProblem;
  status?: number;
  scan: ScanResult | null;
}

const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(DIR + file, "utf8")) as Fixture] as const);

/** The envelope Gemini answers in, which the stub has to imitate exactly. */
const envelope = (scan: ScanResult) =>
  ({ candidates: [{ content: { parts: [{ text: JSON.stringify(scan) }] } }] });

describe("the canned receipts", () => {
  it("is a set worth having", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    // The one the smoke test is for: a bill with lines to assign, at least one
    // of them printed with a count, so the grid's unfold has something to open.
    const [, cafe] = fixtures.find(([name]) => name === "cafe-clock")!;
    expect(cafe.scan!.lineItems.length).toBeGreaterThan(3);
    expect(cafe.scan!.lineItems.some((i) => (i.quantity ?? 0) >= 2)).toBe(true);
    // And one carrying tax and *several* deductions, which no other fixture
    // reaches: they are the grid's rows with no cells, and the discounts are
    // the one row that unfolds to say what it is made of.
    expect(fixtures.some(([, f]) => (f.scan?.discounts.length ?? 0) > 1 && f.scan!.tax)).toBe(true);
  });

  it.each(fixtures)("%s is what it says it is", (_name, fixture) => {
    expect(fixture.note).toBeTruthy();

    if (!fixture.scan) {
      // A failure of the service, not of the photo: no payload to read.
      expect(fixture.status).toBeGreaterThanOrEqual(400);
      return;
    }

    // Through the real parser, so a fixture cannot carry a field the client
    // drops or miss one it needs.
    const result = parseScanResponse(envelope(fixture.scan));
    expect(result).toEqual(fixture.scan);

    if (fixture.exercises === "rejected") {
      expect(result.error).toBeTruthy();
      return;
    }
    expect(result.error).toBeNull();

    const currency = scanCurrency(result, "EUR");
    expect(checkScan(result, currency)).toBe(fixture.exercises === "ok" ? null : fixture.exercises);

    // A readable bill has to reach the form: `amountText` is handed straight
    // to `parseMinor` on save, and a fixture that throws there would fail as
    // a broken app rather than as a broken fixture.
    if (fixture.exercises === "ok") {
      const patch = normalizeScan(result);
      expect(() => parseMinor(patch.amountText!, currency)).not.toThrow();
    }
  });
});
