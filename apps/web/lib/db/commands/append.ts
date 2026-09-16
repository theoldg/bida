import {
  createHlcState, hlcSend, newId,
  type EntityKind, type Id, type Op, type OpDraft,
} from "@bida/core";
import { started } from "../../diag";
import { db, type StoredOp } from "../dexie";
import { getDevice } from "../device";
import { materialise } from "../fold";
import { scheduleSync } from "../sync";

/**
 * The one write. Every command in this directory ends here, and nothing else
 * in the app appends to the log, advances the clock or touches Dexie's tables.
 */

/**
 * Append ops and materialise what they touched, atomically.
 *
 * The device's HLC is advanced inside the same transaction as the write, so a
 * tab that dies mid-command can't leave the clock ahead of the log.
 */
export async function appendOps(
  groupId: Id,
  actor: Id,
  drafts: readonly OpDraft[],
  now = Date.now(),
): Promise<Op[]> {
  const d = db();
  // Every write the person makes, timed: a save that sits behind somebody
  // else's lock is a line on /diag rather than a button that did nothing.
  const done = started("append", `${drafts.length} ops`);
  return d.transaction(
    "rw",
    [d.ops, d.device, d.groups, d.members, d.expenses, d.settlements, d.attachments, d.identities,
      d.rates],
    async () => {
      const device = await getDevice();
      let clock = createHlcState(device.nodeId, device.hlcPhysical, device.hlcCounter);

      const written: StoredOp[] = [];
      for (const draft of drafts) {
        const sent = hlcSend(clock, now);
        clock = sent.state;
        written.push({
          id: newId(),
          groupId,
          entity: draft.entity,
          entityId: draft.entityId,
          kind: draft.kind,
          patch: draft.patch,
          hlc: sent.hlc,
          actor,
          note: draft.note ?? null,
          createdAt: now,
          seq: null,
          pending: 1,
        });
      }

      await d.ops.bulkPut(written);
      await d.device.put({
        ...device,
        hlcPhysical: clock.physical,
        hlcCounter: clock.counter,
      });

      // Dedupe: two ops in one command often touch the same entity.
      const touched = new Map<Id, EntityKind>();
      for (const op of written) touched.set(op.entityId, op.entity);
      for (const [entityId, kind] of touched) await materialise(groupId, kind, entityId);

      return written;
    },
  ).then((written) => {
    done();
    scheduleSync();
    return written;
  }, (err: unknown) => {
    done("failed");
    throw err;
  });
}
