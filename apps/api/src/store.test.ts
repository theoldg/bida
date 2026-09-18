import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, opsSince } from "./store";

/**
 * Deleting a group, against real SQLite running the real migrations.
 *
 * The thing that can be wrong here is not the SQL but what survives it: a
 * delete that leaves a row `ensureGroup` will hand back as a live group is a
 * deletion the next phone to sync undoes (docs/sync.md#deleting-a-group), and
 * nothing in the app would say so. So the test that matters is the push after
 * the delete.
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
    batch: async (stmts: { run: () => Promise<void> }[]) => {
      for (const s of stmts) await s.run();
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
