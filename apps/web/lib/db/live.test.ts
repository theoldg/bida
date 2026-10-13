import Dexie, { liveQuery } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { forget, timeline } from "../diag";
import { db } from "./dexie";
import { keepWarm, sameData, testing } from "./live";

const settle = () => new Promise((r) => setTimeout(r, 60));

/**
 * Not a test of our code: it pins the Dexie behaviour lib/db/live.ts works
 * around. If these fail because Dexie now delivers the error, delete
 * `useLive`'s watchdog and let the error boundary have it.
 */
describe("what liveQuery does with an error the browser caused", () => {
  /** Named the way Chrome names a transaction killed under a frozen page. */
  function killed(name: "DatabaseClosedError" | "AbortError"): Error {
    const err = new Error("killed by the browser");
    err.name = name;
    return err;
  }

  it("delivers neither a value nor an error, and never runs the querier again", async () => {
    const local = new Dexie("live-swallow");
    local.version(1).stores({ rows: "id" });
    await local.open();
    await local.table("rows").put({ id: "a" });

    let runs = 0;
    let kill = true;
    const values: unknown[] = [];
    const errors: unknown[] = [];
    const sub = liveQuery(async () => {
      runs += 1;
      if (kill) {
        kill = false;
        throw killed("DatabaseClosedError");
      }
      return local.table("rows").toArray();
    }).subscribe((v) => values.push(v), (e) => errors.push(e));

    await settle();
    expect(runs).toBe(1);
    // The whole defect in two lines: silence is indistinguishable from slow.
    expect(values).toEqual([]);
    expect(errors).toEqual([]);

    // A write to the very table it reads does not wake it. The subscription is
    // dead, not merely behind.
    await local.table("rows").put({ id: "b" });
    await settle();
    expect(runs).toBe(1);
    expect(values).toEqual([]);

    sub.unsubscribe();
    local.close();
  });

  it("is just as dead after a value it did deliver", async () => {
    const local = new Dexie("live-swallow-2");
    local.version(1).stores({ rows: "id" });
    await local.open();
    await local.table("rows").put({ id: "a" });

    let kill = false;
    const values: unknown[] = [];
    const sub = liveQuery(async () => {
      if (kill) {
        kill = false;
        throw killed("AbortError");
      }
      return local.table("rows").toArray();
    }).subscribe((v) => values.push(v), () => {});

    await settle();
    expect(values).toHaveLength(1);

    kill = true;
    await local.table("rows").put({ id: "b" });
    await settle();
    await local.table("rows").put({ id: "c" });
    await settle();
    // Two more writes, neither delivered: a screen that had drawn once now
    // shows an answer that will never change again.
    expect(values).toHaveLength(1);

    sub.unsubscribe();
    local.close();
  });

  it("is repaired only by subscribing again — which is what `useLive` does", async () => {
    const local = new Dexie("live-swallow-3");
    local.version(1).stores({ rows: "id" });
    await local.open();
    await local.table("rows").put({ id: "a" });

    let kill = true;
    const querier = async () => {
      if (kill) {
        kill = false;
        throw killed("DatabaseClosedError");
      }
      return local.table("rows").toArray();
    };

    const dead: unknown[] = [];
    const first = liveQuery(querier).subscribe((v) => dead.push(v), () => {});
    await settle();
    expect(dead).toEqual([]);
    first.unsubscribe();

    const alive: unknown[] = [];
    const second = liveQuery(querier).subscribe((v) => alive.push(v), () => {});
    await settle();
    expect(alive).toHaveLength(1);

    second.unsubscribe();
    local.close();
  });
});

describe("the health record behind useLive", () => {
  beforeEach(() => testing.reset());

  it("re-subscribes every read when the browser closes the connection", async () => {
    testing.arm();
    await db().open();

    const before = testing.health.epoch;
    // What Dexie itself does from `idbdb.onclose`.
    db().close({ disableAutoOpen: false });
    expect(testing.health.epoch).toBe(before + 1);

    await db().open();
  });

  it("tells subscribers, so the notice and the reads both move", async () => {
    testing.arm();
    await db().open();

    let told = 0;
    const stop = testing.subscribe(() => { told += 1; });
    db().close({ disableAutoOpen: false });
    expect(told).toBe(1);

    stop();
    await db().open();
  });

  it("reopens the connection once per window, re-subscribing every read", async () => {
    testing.arm();
    await db().open();
    forget();

    const before = testing.health.epoch;
    testing.reopen();
    testing.reopen(); // every read on screen gives up in the same tick
    expect(testing.health.epoch).toBe(before + 1);

    // The new connection answers, and the timeline says we closed it, not the browser.
    await db().device.count();
    const what = timeline().map((e) => e.what);
    expect(what).toContain("db.reopen");
    expect(what).not.toContain("db.close");
  });

  it("counts stalls up and back down", () => {
    expect(testing.health.stalls).toBe(0);
    const undoA = testing.addStall();
    const undoB = testing.addStall();
    expect(testing.health.stalls).toBe(2);
    undoA();
    undoB();
    expect(testing.health.stalls).toBe(0);
  });
});

/**
 * The second pinned Dexie behaviour, and why a hidden page reads nothing
 * (lib/db/live.ts). A write re-runs every querier that observed its tables,
 * in this realm and in every other copy on the origin via
 * `BroadcastChannel('x-storagemutated-1')` — making a *backgrounded* copy open
 * a transaction, which a freezable page must never do.
 *
 * If Dexie stops re-running queriers on remote writes, the gate in
 * `timedQuerier` is no longer load-bearing and these say so.
 */
describe("what a write does to a querier that is not on screen", () => {
  it("re-runs one that read the table, which is the poke we must not answer", async () => {
    const local = new Dexie("live-poke");
    local.version(1).stores({ rows: "id" });
    await local.open();

    let runs = 0;
    const sub = liveQuery(async () => {
      runs += 1;
      return local.table("rows").toArray();
    }).subscribe(() => {}, () => {});

    await settle();
    expect(runs).toBe(1);

    // Someone else's write. The querier runs again, opening a transaction —
    // on a frozen page that is where the readonly lock is stranded.
    await local.table("rows").put({ id: "a" });
    await settle();
    expect(runs).toBe(2);

    sub.unsubscribe();
    local.close();
  });

  it("leaves one that touched no table alone, which is what the gate buys", async () => {
    const local = new Dexie("live-gate");
    local.version(1).stores({ rows: "id" });
    await local.open();

    // What `timedQuerier` becomes while hidden: an answer from `remembered`,
    // with no transaction behind it.
    let runs = 0;
    const sub = liveQuery(async () => {
      runs += 1;
      return ["remembered"];
    }).subscribe(() => {}, () => {});

    await settle();
    expect(runs).toBe(1);

    await local.table("rows").put({ id: "a" });
    await settle();
    // Observed nothing, so signalled about nothing. Coming back to the front
    // bumps `epoch`, and that is what starts the real read again.
    expect(runs).toBe(1);

    sub.unsubscribe();
    local.close();
  });
});

describe("the hidden gate", () => {
  beforeEach(() => testing.reset());

  it("reads the live visibility, not the one the render closed over", () => {
    expect(testing.isHidden()).toBe(false); // no document in node
  });

  it("holds the watchdog shut, so a background page never reopens", () => {
    // `stalled` is `waiting && !hidden && …`; the health record is what the
    // hook reads it from, and it starts from the document.
    expect(testing.health.hidden).toBe(false);
    expect(testing.health.stalls).toBe(0);
  });
});

/** Past `WARM_AFTER_MS`, the pause that keeps a warm read off the next screen's own. */
const warmed = () => new Promise((r) => setTimeout(r, 500));

describe("a read kept warm", () => {
  beforeEach(async () => {
    testing.reset();
    await db().groups.clear();
  });

  const count = () => db().groups.count();

  it("keeps its answer current with nothing on screen reading it", async () => {
    keepWarm("count", count, ["a"]);
    await warmed();
    expect(testing.remembered.get('count ["a"]')).toBe(0);

    // The edit made on another screen, which the list comes back already showing.
    await db().groups.put({ id: "g1" } as never);
    await settle();
    expect(testing.remembered.get('count ["a"]')).toBe(1);
  });

  it("is brought back with the rest when the browser killed it", async () => {
    testing.arm();
    let kill = true;
    keepWarm("count", async () => {
      if (kill) {
        kill = false;
        const err = new Error("killed by the browser");
        err.name = "DatabaseClosedError";
        throw err;
      }
      return count();
    }, ["b"]);
    await warmed();
    await db().groups.put({ id: "g2" } as never);
    await settle();
    // Swallowed, so dead even to a write (the first describe above).
    expect(testing.remembered.has('count ["b"]')).toBe(false);

    db().close({ disableAutoOpen: false });
    await db().open();
    await settle();
    expect(testing.remembered.get('count ["b"]')).toBe(1);
  });

  it("keeps only the newest few", () => {
    for (let i = 0; i <= testing.WARM; i++) keepWarm("count", count, [i]);
    expect(testing.warm.size).toBe(testing.WARM);
    expect(testing.warm.has("count [0]")).toBe(false);
    expect(testing.warm.has(`count [${testing.WARM}]`)).toBe(true);
  });

  it("keeps the object it had when answered again with the same rows", async () => {
    await db().groups.put({ id: "g3", name: "Riad" } as never);
    keepWarm("rows", () => db().groups.toArray(), ["c"]);
    await warmed();
    const first = testing.remembered.get('rows ["c"]');
    expect(first).toEqual([{ id: "g3", name: "Riad" }]);

    // A write that changes nothing still re-runs the read.
    await db().groups.put({ id: "g3", name: "Riad" } as never);
    await settle();
    expect(testing.remembered.get('rows ["c"]')).toBe(first);

    await db().groups.put({ id: "g3", name: "Tagine" } as never);
    await settle();
    expect(testing.remembered.get('rows ["c"]')).toEqual([{ id: "g3", name: "Tagine" }]);
  });
});

describe("sameData", () => {
  it("compares records and arrays by what they hold", () => {
    expect(sameData({ a: [1, { b: "x" }], c: null }, { a: [1, { b: "x" }], c: null })).toBe(true);
    expect(sameData([{ a: 1 }], [{ a: 2 }])).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData({ a: 1 }, [1])).toBe(false);
    expect(sameData(undefined, null)).toBe(false);
    expect(sameData(0, 0)).toBe(true);
  });

  it("compares anything that is not a plain record by identity", () => {
    expect(sameData(new Map([[1, 2]]), new Map([[1, 2]]))).toBe(false);
    const map = new Map();
    expect(sameData({ m: map }, { m: map })).toBe(true);
  });
});

/**
 * Pins what `groupRows`' unsynced count (lib/hooks.ts) leans on: an op leaving
 * the `[groupId+pending]` range wakes a count of it, not only one entering it,
 * and another group's op wakes it to the same answer.
 */
describe("a live count of a compound index range", () => {
  it("is woken by a row leaving the range, as an op the server accepted does", async () => {
    const local = new Dexie("live-range");
    local.version(1).stores({ ops: "id, [groupId+pending]" });
    await local.open();
    await local.table("ops").bulkPut([
      { id: "a", pending: 1, groupId: "g" },
      { id: "b", pending: 1, groupId: "g" },
      { id: "c", pending: 1, groupId: "other" },
    ]);

    const counts: number[] = [];
    const sub = liveQuery(() => local.table("ops").where("[groupId+pending]").equals(["g", 1]).count())
      .subscribe((n) => counts.push(n), () => {});
    await settle();
    // How sync marks one accepted (lib/db/sync.ts).
    await local.table("ops").update("a", { seq: 7, pending: 0 });
    await settle();
    await local.table("ops").put({ id: "d", pending: 1, groupId: "g" });
    await settle();
    expect(counts.filter((n, i) => n !== counts[i - 1])).toEqual([2, 1, 2]);

    sub.unsubscribe();
    local.close();
  });
});
