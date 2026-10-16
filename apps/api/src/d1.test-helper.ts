// Doc: docs/testing.md#unit-tests
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** `0002` is the scan budget, which no store test reads. */
const MIGRATIONS = ["0001_init.sql", "0003_group_tombstone.sql", "0004_op_batches.sql", "0005_splits.sql"];

type Row = Record<string, unknown>;

/** D1 as real SQLite under the real migrations, binding and batching as D1 does. */
export function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  // D1 binds at most 100; SQLite thousands. Without this the fake passes a
  // clause that fails on the phone with the biggest queue.
  const D1_MAX_BOUND_PARAMS = 100;
  const bound = (args: unknown[]) => {
    if (args.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(`too many SQL variables: ${args.length} > ${D1_MAX_BOUND_PARAMS}`);
    }
    return args as never[];
  };
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => prepare(sql, next),
    first: async () => (sqlite.prepare(sql).get(...bound(args)) ?? null) as Row | null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bound(args)) as Row[] }),
    run: async () => { sqlite.prepare(sql).run(...bound(args)); },
  });
  return {
    sqlite,
    prepare,
    // D1 batches are one transaction; `acceptOps` depends on it, so a loose fake
    // would pass a broken store.
    batch: async (stmts: { all: () => Promise<{ results: Row[] }> }[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.all());
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;
}
