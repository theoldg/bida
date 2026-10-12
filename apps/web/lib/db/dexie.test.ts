import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { createHlcState, formatHlc, RECEIPT_MODE_SINCE } from "@bida/core";
import { db } from "./dexie";

/**
 * The materialised tables are refolded only when a pull brings ops, so a fold
 * that changes its reading has to reach rows already stored on the way in.
 */
describe("opening a phone's database on this build", () => {
  it("refolds parts typed beside a bill that an older fold stored as a receipt", async () => {
    const shares = { mode: "shares", weights: { a: 2, b: 1 } };
    const patch = {
      description: "Dinner", occurredAt: 1, amountMinor: 9000, currency: "EUR", rateToBase: "1",
      baseAmountMinor: 9000, paidBy: "a", split: shares,
      receiptItems: [{ label: "Steak", amount: "60.00" }, { label: "Coffee", amount: "30.00" }],
    };
    const op = (id: string, entityId: string, ms: number) => ({
      id, groupId: "g1", entity: "expense", entityId, kind: "create", patch,
      hlc: formatHlc(createHlcState("aaa", ms)), actor: "a", note: null, createdAt: ms, seq: 1, pending: 0,
    });
    // What the build before stored: both read as grids.
    const old = new Dexie("hajsik");
    old.version(9).stores({
      ops: "id, groupId, entityId, hlc, pending, [groupId+hlc]",
      expenses: "id, groupId, occurredAt, [groupId+occurredAt]",
      notices: "id, groupId",
    });
    await old.table("ops").bulkPut([op("o1", "typed", RECEIPT_MODE_SINCE + 1), op("o2", "grid", RECEIPT_MODE_SINCE - 1)]);
    const stored = (id: string) => ({ ...patch, id, groupId: "g1", split: { mode: "receipt", weights: shares.weights } });
    await old.table("expenses").bulkPut([stored("typed"), stored("grid")]);
    old.close();

    expect((await db().expenses.get("typed"))?.split).toEqual(shares);
    expect((await db().expenses.get("grid"))?.split.mode).toBe("receipt");
  });
});
