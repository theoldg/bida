import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SCAN_LIMITS } from "@bida/core";
import { beforeEach, describe, expect, it } from "vitest";
import { clientKey, countScans, overLimit, recordScan } from "./scan-limits";

/**
 * The scan budget, against real SQLite running the real migration.
 *
 * A stub that answers whatever the assertion wants would prove nothing here:
 * the thing that can be wrong is the query — six conditional sums over one
 * day of rows — and an off-by-one in it either lets an eleventh scan through
 * or refuses a tenth. So `0002_scan_limits.sql` is executed as written, and
 * the shim below is only enough D1 to carry the two statements this module
 * sends.
 */

type Row = Record<string, unknown>;

function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0002_scan_limits.sql", import.meta.url), "utf8"));
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => prepare(sql, next),
    first: async () => (sqlite.prepare(sql).get(...args as never[]) ?? null) as Row | null,
    run: async () => { sqlite.prepare(sql).run(...args as never[]); },
  });
  return {
    prepare,
    batch: async (stmts: { run: () => Promise<void> }[]) => {
      for (const s of stmts) await s.run();
    },
  } as unknown as D1Database;
}

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

let db: D1Database;
beforeEach(() => { db = fakeD1(); });

/** `n` scans for one caller/client pair, spaced back from `now`. */
async function spend(n: number, caller: string, client: string | null, spacing: number) {
  for (let i = 0; i < n; i++) await recordScan(db, caller, client, NOW - i * spacing);
}

describe("countScans", () => {
  it("counts nothing on an empty log", async () => {
    expect(await countScans(db, "g1", "aa", NOW)).toEqual({
      caller: { hour: 0, day: 0 }, client: { hour: 0, day: 0 }, global: { hour: 0, day: 0 },
    });
  });

  it("separates the three buckets", async () => {
    await spend(3, "g1", "aa", 1000);
    await spend(2, "g2", "aa", 1000);
    await spend(4, "g3", "bb", 1000);
    const counts = await countScans(db, "g1", "aa", NOW);
    expect(counts.caller).toEqual({ hour: 3, day: 3 });
    expect(counts.client).toEqual({ hour: 5, day: 5 });
    expect(counts.global).toEqual({ hour: 9, day: 9 });
  });

  it("an hour ago is out of the hour and inside the day", async () => {
    await spend(3, "g1", "aa", 2 * HOUR);
    const counts = await countScans(db, "g1", "aa", NOW);
    expect(counts.caller).toEqual({ hour: 1, day: 3 });
  });

  it("forgets a day-old scan, and drops the row on the next one", async () => {
    await recordScan(db, "g1", "aa", NOW - 25 * HOUR);
    expect((await countScans(db, "g1", "aa", NOW)).caller.day).toBe(0);
    await recordScan(db, "g2", "bb", NOW);
    // Pruned, not merely uncounted — the 24h horizon is what keeps the query
    // scanning at most a global daily cap's worth of rows.
    const all = await db.prepare("SELECT COUNT(*) AS n FROM scan_hits").first<{ n: number }>();
    expect(all?.n).toBe(1);
  });

  it("a saltless deployment has no client bucket rather than one shared one", async () => {
    await spend(SCAN_LIMITS.client.hour + 5, "g1", null, 1000);
    const counts = await countScans(db, "g2", null, NOW);
    expect(counts.client).toEqual({ hour: 0, day: 0 });
    expect(overLimit(counts)).toBeNull();
  });
});

describe("overLimit", () => {
  const at = (scope: "caller" | "client" | "global", hour: number, day: number) => ({
    caller: { hour: 0, day: 0 }, client: { hour: 0, day: 0 }, global: { hour: 0, day: 0 },
    [scope]: { hour, day },
  });

  it("passes a log one short of every limit", () => {
    expect(overLimit({
      caller: { hour: SCAN_LIMITS.caller.hour - 1, day: SCAN_LIMITS.caller.day - 1 },
      client: { hour: SCAN_LIMITS.client.hour - 1, day: SCAN_LIMITS.client.day - 1 },
      global: { hour: SCAN_LIMITS.global.hour - 1, day: SCAN_LIMITS.global.day - 1 },
    })).toBeNull();
  });

  for (const scope of ["caller", "client", "global"] as const) {
    it(`refuses on the ${scope} hour`, () => {
      expect(overLimit(at(scope, SCAN_LIMITS[scope].hour, 0))).toBe(scope);
    });
    it(`refuses on the ${scope} day`, () => {
      expect(overLimit(at(scope, 0, SCAN_LIMITS[scope].day))).toBe(scope);
    });
  }

  it("names the global cap first — that refusal isn't about the person reading it", () => {
    expect(overLimit({
      caller: { hour: SCAN_LIMITS.caller.hour, day: 0 },
      client: { hour: SCAN_LIMITS.client.hour, day: 0 },
      global: { hour: SCAN_LIMITS.global.hour, day: 0 },
    })).toBe("global");
  });
});

describe("clientKey", () => {
  it("is stable, keyed, and never the address", async () => {
    const a = await clientKey("203.0.113.7", "salt");
    expect(a).toBe(await clientKey("203.0.113.7", "salt"));
    expect(a).not.toBe(await clientKey("203.0.113.8", "salt"));
    // The whole point of the secret: the same address under another salt is
    // another key, so a leaked table cannot be walked back to addresses.
    expect(a).not.toBe(await clientKey("203.0.113.7", "other salt"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("203");
  });
});
