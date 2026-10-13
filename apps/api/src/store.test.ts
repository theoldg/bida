import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BATCH_OPS, PAGE_CHARS, PAGE_OPS, acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, pullPage,
} from "./store";
import { chunk, type SealedOp } from "@bida/core";

/**
 * The store against real SQLite with the real migrations. What matters: a
 * delete must survive the next phone's push (docs/sync.md#deleting-a-group),
 * and a seq must never be visible before its row — so `batch` is transactional
 * like D1's, and the accept tests look at what another caller sees mid-batch.
 */

type Row = Record<string, unknown>;

function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_init.sql", "0003_group_tombstone.sql", "0004_op_batches.sql"]) {
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

const NOW = 1_700_000_000_000;
const sealed = (id: string, size = 4) => ({ id, groupId: "g1", sealed: "A".repeat(size), seq: null });

/** Every op after `since`, a page at a time, as a phone walks it. */
async function opsSince(db: D1Database, groupId: string, since: number): Promise<SealedOp[]> {
  const out: SealedOp[] = [];
  for (;;) {
    const head = (await getGroup(db, groupId))?.last_op_seq ?? 0;
    const page = await pullPage(db, groupId, since, head);
    out.push(...page.ops);
    if (!page.more) return out;
    expect(page.upTo).toBeGreaterThan(since);
    since = page.upTo;
  }
}

/** What D1 bills: a row written for the table row and for each index entry. */
function rowsIn(db: D1Database, table: string): number {
  const sqlite = (db as unknown as { sqlite: { prepare(sql: string): { get(): unknown } } }).sqlite;
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

let db: D1Database;
beforeEach(async () => {
  db = fakeD1();
  await ensureGroup(db, "g1", "hash-of-token", NOW);
  await acceptOps(db, "g1", [sealed("op1"), sealed("op2")], 0, NOW);
});

describe("deleteGroup", () => {
  it("takes every op with it", async () => {
    expect(await opsSince(db, "g1", 0)).toHaveLength(2);
    await deleteGroup(db, "g1", NOW);
    expect(await opsSince(db, "g1", 0)).toHaveLength(0);
    expect(rowsIn(db, "op_batches")).toBe(0);
  });

  it("takes the ops written before batching too", async () => {
    await legacyOp(db, "old1", 3);
    await deleteGroup(db, "g1", NOW);
    expect(rowsIn(db, "ops")).toBe(0);
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

/** An op as a build before batching stored it, one row of `ops`, its seq reserved. */
async function legacyOp(db: D1Database, id: string, seq: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE groups SET last_op_seq = ? WHERE id = ?").bind(seq, "g1"),
    db.prepare("INSERT INTO ops (seq, id, group_id, sealed, received_at) VALUES (?, ?, ?, ?, ?)")
      .bind(seq, id, "g1", "AQz8", NOW),
  ]);
}

describe("acceptOps", () => {
  it("leaves no reserved sequence number without a row behind it", async () => {
    await acceptOps(db, "g1", [sealed("op3"), sealed("op4")], 2, NOW);
    const group = await getGroup(db, "g1");
    const ops = await opsSince(db, "g1", 0);
    // `latestSeq` names a row already readable, so a cursor on it skips nothing.
    expect(group!.last_op_seq).toBe(4);
    expect(ops.map((op) => op.seq)).toEqual([1, 2, 3, 4]);
  });

  it("numbers ops in the order they were pushed", async () => {
    const { assigned, latestSeq } = await acceptOps(
      db, "g1", [sealed("op3"), sealed("op4"), sealed("op5")], 2, NOW,
    );
    expect(assigned).toEqual({ op3: 3, op4: 4, op5: 5 });
    expect(latestSeq).toBe(5);
  });

  it("writes one row for a push, not one per op", async () => {
    await acceptOps(db, "g1", Array.from({ length: 50 }, (_, i) => sealed(`p${i}`)), 2, NOW);
    expect(rowsIn(db, "op_batches")).toBe(2);
    expect(rowsIn(db, "ops")).toBe(0);
  });

  it("cuts a push into rows a row can hold", async () => {
    const many = Array.from({ length: BATCH_OPS * 2 + 1 }, (_, i) => sealed(`p${i}`));
    await acceptOps(db, "g1", many, 2, NOW);
    expect(rowsIn(db, "op_batches")).toBe(1 + 3);
    const big = Array.from({ length: 3 }, (_, i) => sealed(`big${i}`, 600_000));
    await acceptOps(db, "g1", big, 2, NOW);
    expect(rowsIn(db, "op_batches")).toBe(1 + 3 + 3);
    expect((await opsSince(db, "g1", 0)).map((op) => op.seq))
      .toEqual(Array.from({ length: 2 + many.length + 3 }, (_, i) => i + 1));
  });

  it("takes the counter back down with a batch that fails", async () => {
    // A row already sitting where the next one lands fails the insert, which
    // rolls the reserve back too — a counter ahead of the log is the cursor bug.
    await db.prepare("INSERT INTO op_batches (group_id, last_seq, ids, sealed, received_at) VALUES (?, ?, ?, ?, ?)")
      .bind("g1", 3, "[]", "[]", NOW).run();
    await expect(acceptOps(db, "g1", [sealed("op3")], 2, NOW)).rejects.toThrow();
    const group = await getGroup(db, "g1");
    expect(group!.last_op_seq).toBe(2);
  });

  it("hands a re-pushed op the seq it already had", async () => {
    const again = await acceptOps(db, "g1", [sealed("op2"), sealed("op3")], 0, NOW);
    expect(again.assigned).toEqual({ op2: 2, op3: 3 });
    const group = await getGroup(db, "g1");
    expect(group!.last_op_seq).toBe(3);
  });

  it("finds a re-push in a row that starts at or before the phone's cursor", async () => {
    // The first answer was lost, so the phone's cursor is short of the op; a
    // row it straddles still holds it.
    const again = await acceptOps(db, "g1", [sealed("op2")], 1, NOW);
    expect(again.assigned).toEqual({ op2: 2 });
    expect(rowsIn(db, "op_batches")).toBe(1);
  });

  it("finds a re-push of an op stored before batching", async () => {
    await legacyOp(db, "old3", 3);
    const again = await acceptOps(db, "g1", [sealed("old3")], 0, NOW);
    expect(again.assigned).toEqual({ old3: 3 });
    expect((await getGroup(db, "g1"))!.last_op_seq).toBe(3);
  });

  it("stores an op pushed twice in one request once", async () => {
    const { assigned } = await acceptOps(db, "g1", [sealed("op3"), sealed("op3")], 2, NOW);
    expect(assigned).toEqual({ op3: 3 });
    expect(await opsSince(db, "g1", 0)).toHaveLength(3);
  });
});

describe("a push bigger than one query can carry", () => {
  const many = Array.from({ length: 150 }, (_, i) => sealed(`bulk${i}`));

  it("takes all of it, numbered without a gap", async () => {
    const { assigned, latestSeq } = await acceptOps(db, "g1", many, 2, NOW);
    expect(Object.keys(assigned)).toHaveLength(150);
    expect(assigned["bulk0"]).toBe(3);
    expect(assigned["bulk149"]).toBe(152);
    expect(latestSeq).toBe(152);
    const ops = await opsSince(db, "g1", 2);
    expect(ops.map((op) => op.seq)).toEqual(Array.from({ length: 150 }, (_, i) => i + 3));
  });

  it("stays idempotent across the cut", async () => {
    await acceptOps(db, "g1", many, 2, NOW);
    const again = await acceptOps(db, "g1", many, 2, NOW);
    expect(again.assigned["bulk0"]).toBe(3);
    expect(again.assigned["bulk149"]).toBe(152);
    expect(again.latestSeq).toBe(152);
    expect(await opsSince(db, "g1", 0)).toHaveLength(152);
  });
});

describe("pullPage", () => {
  it("reads the ops stored before batching and after, in seq order", async () => {
    // A group that had ops 1–2 in `ops` before the move; batching numbers on.
    db = fakeD1();
    await ensureGroup(db, "g1", "hash-of-token", NOW);
    await legacyOp(db, "old1", 1);
    await legacyOp(db, "old2", 2);
    await acceptOps(db, "g1", [sealed("new3"), sealed("new4")], 2, NOW);
    expect((await opsSince(db, "g1", 0)).map((op) => op.id)).toEqual(["old1", "old2", "new3", "new4"]);
    expect((await opsSince(db, "g1", 1)).map((op) => op.id)).toEqual(["old2", "new3", "new4"]);
    expect((await opsSince(db, "g1", 3)).map((op) => op.id)).toEqual(["new4"]);
  });

  it("stops at a page of seqs and says there is more", async () => {
    const total = PAGE_OPS * 2 + 7;
    for (const slice of chunk(Array.from({ length: total }, (_, i) => sealed(`p${i}`)), 50)) {
      await acceptOps(db, "g1", slice, 0, NOW);
    }
    const head = 2 + total;
    const first = await pullPage(db, "g1", 0, head);
    expect(first.ops).toHaveLength(PAGE_OPS);
    expect(first.upTo).toBe(PAGE_OPS);
    expect(first.more).toBe(true);
    // A cursor mid-row: the row is read again, and only what is past it handed out.
    const mid = await pullPage(db, "g1", first.upTo + 3, head);
    expect(mid.ops[0]!.seq).toBe(first.upTo + 4);
    expect((await opsSince(db, "g1", 0)).map((op) => op.seq))
      .toEqual(Array.from({ length: head }, (_, i) => i + 1));
  });

  it("stops at a page of characters, ending on the last op it holds", async () => {
    const size = Math.floor(PAGE_CHARS / 3);
    await acceptOps(db, "g1", Array.from({ length: 5 }, (_, i) => sealed(`b${i}`, size)), 2, NOW);
    const page = await pullPage(db, "g1", 2, 7);
    expect(page.ops.map((op) => op.seq)).toEqual([3, 4, 5]);
    expect(page.upTo).toBe(5);
    expect(page.more).toBe(true);
  });

  it("hands out an op bigger than a page alone, rather than stalling on it", async () => {
    await acceptOps(db, "g1", [sealed("huge", PAGE_CHARS + 1), sealed("next")], 2, NOW);
    const page = await pullPage(db, "g1", 2, 4);
    expect(page.ops.map((op) => op.id)).toEqual(["huge"]);
    expect(page.upTo).toBe(3);
  });

  it("hands out nothing past the head it was given", async () => {
    // Committed after the caller read the head: the next pull's.
    await acceptOps(db, "g1", [sealed("op3")], 2, NOW);
    const page = await pullPage(db, "g1", 0, 2);
    expect(page.ops.map((op) => op.seq)).toEqual([1, 2]);
    expect(page).toMatchObject({ upTo: 2, more: false });
  });

  it("answers a phone already at the head with nothing", async () => {
    expect(await pullPage(db, "g1", 2, 2)).toEqual({ ops: [], upTo: 2, more: false });
  });
});

