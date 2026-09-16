import Dexie, { liveQuery } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { forget, timeline } from "../diag";
import { db } from "./dexie";
import { testing } from "./live";

const settle = () => new Promise((r) => setTimeout(r, 60));

/**
 * The first block is not a test of our code. It pins the Dexie behaviour that
 * lib/db/live.ts exists to work around, so that the day an upgrade fixes it we
 * find out here rather than carrying the workaround forever. If these fail
 * because Dexie now delivers the error, delete `useLive`'s watchdog and let
 * the error boundary have it.
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
