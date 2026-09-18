import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, opsSince } from "./store";

/**
 * The store, against real SQLite running the real migrations.
 *
 * Two things can be wrong here, and neither is the SQL. A delete that leaves a
 * row `ensureGroup` will hand back as a live group is a deletion the next phone
 * to sync undoes (docs/sync.md#deleting-a-group), and nothing in the app would
 * say so — so the test that matters is the push after the delete. And a seq
 * number reserved before its row exists is an op a pulling phone is told about
 * and can never read, so `batch` below is a transaction like D1's: the point of
 * the accept tests is what another caller sees *during* one.
 */

type Row = Record<string, unknown>;

function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_init.sql", "0003_group_tombstone.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const prepare = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => prepare(sql, next),
    first: async () => (sqlite.prepare(sql).get(...args as never[]) ?? null) as Row | null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args as never[]) as Row[] }),
    run: async () => { sqlite.prepare(sql).run(...args as never[]); },
  });
  return {
    prepare,
    // D1 runs a batch in one transaction and rolls the whole thing back if any
    // statement fails. `acceptOps` reserves and inserts in a single batch on
    // exactly that promise, so a fake that ran the statements loose would pass
    // a store that cannot hold its invariant.
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

const NOW = 1_700_000_000_000;
const sealed = (id: string) => ({ id, groupId: "g1", sealed: "AQz8", seq: null });

let db: D1Database;
beforeEach(async () => {
  db = fakeD1();
  await ensureGroup(db, "g1", "hash-of-token", NOW);
  await acceptOps(db, "g1", [sealed("op1"), sealed("op2")], NOW);
});

describe("deleteGroup", () => {
  it("takes every op with it", async () => {
    expect(await opsSince(db, "g1", 0)).toHaveLength(2);
    await deleteGroup(db, "g1", NOW);
    expect(await opsSince(db, "g1", 0)).toHaveLength(0);
  });

  it("leaves a tombstone, not a group", async () => {
    await deleteGroup(db, "g1", NOW);
    const group = await getGroup(db, "g1");
    expect(group).not.toBeNull();
    expect(isDeleted(group!)).toBe(true);
    // Nothing is kept that could say anything about the group: not the token
    // this server was checking, and not a single op.
    expect(group!.token_hash).toBe("");
  });

  it("is what a later push meets, so the id is never registered again", async () => {
    await deleteGroup(db, "g1", NOW);
    // A phone that still holds the link, pushing its whole log back.
    const group = await ensureGroup(db, "g1", "hash-of-token", NOW + 1000);
    expect(isDeleted(group)).toBe(true);
    expect(group.created_at).toBe(NOW);
  });

  it("never hands a new op the sequence number of a deleted one", async () => {
    await deleteGroup(db, "g1", NOW);
    const group = await getGroup(db, "g1");
    expect(group!.last_op_seq).toBe(2);
  });

  it("leaves a live group alone", async () => {
    const group = await getGroup(db, "g1");
    expect(isDeleted(group!)).toBe(false);
  });
});

describe("acceptOps", () => {
  it("leaves no reserved sequence number without a row behind it", async () => {
    await acceptOps(db, "g1", [sealed("op3"), sealed("op4")], NOW);
    const group = await getGroup(db, "g1");
    const ops = await opsSince(db, "g1", 0);
    // The invariant the pulling phone spends: `latestSeq` names a row it can
    // already read, so a cursor parked on it has skipped nothing.
    expect(group!.last_op_seq).toBe(4);
    expect(ops.map((op) => op.seq)).toEqual([1, 2, 3, 4]);
  });

  it("numbers ops in the order they were pushed", async () => {
    const { assigned, latestSeq } = await acceptOps(
      db, "g1", [sealed("op3"), sealed("op4"), sealed("op5")], NOW,
    );
    expect(assigned).toEqual({ op3: 3, op4: 4, op5: 5 });
    expect(latestSeq).toBe(5);
  });

  it("takes the counter back down with a batch that fails", async () => {
    // Two rows for one id: the second insert hits `ops.id` and the whole batch
    // rolls back. What must not survive is the reserve — a counter left ahead
    // of the log is the cursor bug with no op to show for it.
    await expect(acceptOps(db, "g1", [sealed("op3"), sealed("op3")], NOW)).rejects.toThrow();
    const group = await getGroup(db, "g1");
    expect(group!.last_op_seq).toBe(2);
    expect(await opsSince(db, "g1", 0)).toHaveLength(2);
  });

  it("hands a re-pushed op the seq it already had", async () => {
    const again = await acceptOps(db, "g1", [sealed("op2"), sealed("op3")], NOW);
    expect(again.assigned).toEqual({ op2: 2, op3: 3 });
    const group = await getGroup(db, "g1");
    expect(group!.last_op_seq).toBe(3);
  });
});
