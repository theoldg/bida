import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, opsSince } from "./store";

/**
 * The store against real SQLite with the real migrations. What matters: a
 * delete must survive the next phone's push (docs/sync.md#deleting-a-group),
 * and a seq must never be visible before its row — so `batch` is transactional
 * like D1's, and the accept tests look at what another caller sees mid-batch.
 */

type Row = Record<string, unknown>;

function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_init.sql", "0003_group_tombstone.sql"]) {
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
    // Nothing kept that says anything about the group: no token, no op.
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
    // `latestSeq` names a row already readable, so a cursor on it skips nothing.
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
    // The duplicate insert rolls the batch back, reserve included — a counter
    // ahead of the log is the cursor bug.
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

describe("a push bigger than one query can carry", () => {
  const many = Array.from({ length: 150 }, (_, i) => sealed(`bulk${i}`));

  it("takes all of it, numbered without a gap", async () => {
    const { assigned, latestSeq } = await acceptOps(db, "g1", many, NOW);
    expect(Object.keys(assigned)).toHaveLength(150);
    expect(assigned["bulk0"]).toBe(3);
    expect(assigned["bulk149"]).toBe(152);
    expect(latestSeq).toBe(152);
    const ops = await opsSince(db, "g1", 2);
    expect(ops.map((op) => op.seq)).toEqual(Array.from({ length: 150 }, (_, i) => i + 3));
  });

  it("stays idempotent across the cut", async () => {
    await acceptOps(db, "g1", many, NOW);
    const again = await acceptOps(db, "g1", many, NOW);
    expect(again.assigned["bulk0"]).toBe(3);
    expect(again.assigned["bulk149"]).toBe(152);
    expect(again.latestSeq).toBe(152);
    expect(await opsSince(db, "g1", 0)).toHaveLength(152);
  });
});
