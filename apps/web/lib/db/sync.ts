import { createHlcState, hlcReceive, type Op } from "@bida/core";
import { started } from "../diag";
import { getDevice } from "./device";
import { db, type StoredOp } from "./dexie";
import { rebuild } from "./fold";

/**
 * The sync engine (docs/sync.md). A single-flight push+pull per group over
 * the two `/api/groups/:id/ops` endpoints, triggered by local writes,
 * visibility, connectivity, and a slow foreground interval. Never blocks the
 * UI — every write already lands in Dexie synchronously via commands.ts;
 * this only ships the log to the server and pulls what's new.
 */

/**
 * A sync attempt that reached the server and was refused. Carries the status
 * because 403 (this device's secret doesn't match the group's) is the one
 * failure retrying will never fix — it needs a fresh invite link.
 */
export class SyncHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`sync failed: ${status} ${body}`);
    this.name = "SyncHttpError";
  }
}

interface PushPullResponse {
  assigned: Record<string, number>;
  ops: Op[];
  latestSeq: number;
}

async function pushPullGroup(
  groupId: string,
  secret: string,
  since: number,
  pending: readonly StoredOp[],
): Promise<PushPullResponse> {
  const ops: Op[] = pending.map((op) => ({
    id: op.id,
    groupId: op.groupId,
    entity: op.entity,
    entityId: op.entityId,
    kind: op.kind,
    patch: op.patch,
    hlc: op.hlc,
    actor: op.actor,
    note: op.note,
    createdAt: op.createdAt,
    seq: null,
  }));

  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ops, since }),
  });
  if (!res.ok) {
    throw new SyncHttpError(res.status, await res.text().catch(() => ""));
  }
  return (await res.json()) as PushPullResponse;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
}

/**
 * Remember that an attempt failed, so a screen can say so. Every caller of
 * `syncGroup` swallows the rejection somewhere — the point of writing it down
 * is that a phone whose changes are going nowhere used to look identical to
 * one that was up to date.
 */
async function recordFailure(groupId: string, err: unknown): Promise<void> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return;
  await d.groupKeys.put({
    ...key,
    failure: {
      count: (key.failure?.count ?? 0) + 1,
      at: Date.now(),
      status: err instanceof SyncHttpError ? err.status : undefined,
    },
  });
}

/** One run per group at a time — see `syncGroup`. */
const inFlight = new Map<string, Promise<SyncOutcome | undefined>>();

/**
 * Push this device's unsynced ops for one group and pull whatever the server
 * has that this device hasn't seen. A no-op (returns `undefined`) if this
 * device doesn't hold that group's secret.
 *
 * Rejects on failure, having recorded it on the group's key first — callers
 * are free to ignore the rejection, and the UI reads the record instead.
 *
 * Single-flight per group: a second call joins the run already going rather
 * than starting another. `syncAll` has a guard of its own, but opening a group
 * calls this directly (app/g/page.tsx) and used to race the loop's run for the
 * same group — the same ops pushed twice, the same ops pulled twice, and two
 * `rebuild()`s taking the readwrite lock on every table in turn at exactly the
 * moment the screen was waiting to read them.
 */
export function syncGroup(groupId: string): Promise<SyncOutcome | undefined> {
  const already = inFlight.get(groupId);
  if (already) return already;
  const run = syncGroupOnce(groupId).finally(() => { inFlight.delete(groupId); });
  inFlight.set(groupId, run);
  return run;
}

async function syncGroupOnce(groupId: string): Promise<SyncOutcome | undefined> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return undefined;

  const pending = await d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).toArray();
  let response: PushPullResponse;
  // The one step here that waits on a network rather than on this phone.
  const sent = started("sync.pushpull");
  try {
    response = await pushPullGroup(groupId, key.secret, key.lastSeq, pending);
  } catch (err) {
    sent("failed");
    await recordFailure(groupId, err);
    throw err;
  }
  sent(`${pending.length} up, ${response.ops.length} down`);
  const { assigned, ops: pulled, latestSeq } = response;

  await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
    for (const op of pending) {
      const seq = assigned[op.id];
      if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
    }
    if (pulled.length > 0) {
      await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
      // Adopt every stamp we've just stored, so this device's next op sorts
      // after the ops it has seen. Without this the clock only ever moved on
      // send: reading a peer's expense and correcting it stamped the
      // correction *before* the create when that peer's phone ran fast, and
      // the fold discarded it — the amount changed, then snapped back. In the
      // same transaction as the ops themselves, for the same reason appendOps
      // advances it in its own: a tab that dies here must not leave the clock
      // trailing an op the log already holds.
      const device = await getDevice();
      const now = Date.now();
      let clock = createHlcState(device.nodeId, device.hlcPhysical, device.hlcCounter);
      for (const op of pulled) clock = hlcReceive(clock, op.hlc, now);
      await d.device.put({
        ...device, hlcPhysical: clock.physical, hlcCounter: clock.counter,
      });
    }
    const current = await d.groupKeys.get(groupId);
    await d.groupKeys.put({
      ...current,
      groupId,
      secret: key.secret,
      lastSeq: Math.max(latestSeq, current?.lastSeq ?? 0),
      lastSyncedAt: Date.now(),
      failure: undefined,
    });
  });

  // A pulled op can slot in earlier than ops already folded locally — refold
  // the whole group rather than risk applying out of HLC order. See
  // docs/sync.md#gotchas.
  if (pulled.length > 0) {
    await rebuild(groupId);
    // A merge is the only thing that can produce an illegal state — every
    // local write is refused before it lands — so this is where healing
    // belongs, not on a screen somebody may never open. It writes ops of its
    // own, which the next run pushes. Imported lazily because the command
    // layer imports this file (`appendOps` schedules a sync); a static import
    // would close the cycle.
    const { healGroup } = await import("./commands/groups");
    // Up to eight passes, each folding the whole log — worth its own line.
    const healed = started("heal");
    await healGroup(groupId).then((n) => healed(`${n} ops`), () => healed("failed"));
  }

  return { pushed: pending.length, pulled: pulled.length };
}

let running: Promise<void> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
let backoffMs = 2000;
const BACKOFF_MAX_MS = 60000;

/**
 * Runs every group's sync once, sequentially. Single-flight across the whole
 * run, not per group: an overlapping call joins the run in flight instead of
 * starting a second one.
 *
 * It has to be. Five things trigger this — a local write, visibility, `online`,
 * the 60s interval, and the backoff timer itself — and the second caller used
 * to skip the groups already in flight, finish with nothing attempted, then
 * clear the pending retry and reset the backoff to 2s. Against a dead server
 * the backoff never grew past its first step.
 */
export function syncAll(): Promise<void> {
  running ??= runSyncAll().finally(() => { running = undefined; });
  return running;
}

async function runSyncAll(): Promise<void> {
  const keys = await db().groupKeys.toArray();
  // A forgotten group keeps its secret — reopening the invite link un-forgets
  // it — but it stops costing cellular data in the meantime. Without this,
  // `forgetGroup` only hid the row while its ops went on flowing in forever.
  const left = new Set((await getDevice()).leftGroups ?? []);
  let anyFailure = false;
  for (const key of keys) {
    if (left.has(key.groupId)) continue;
    try {
      await syncGroup(key.groupId);
    } catch {
      anyFailure = true;
    }
  }

  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = undefined;
  }
  if (anyFailure) {
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    backoffTimer = setTimeout(() => { void syncAll(); }, wait);
  } else {
    backoffMs = 2000;
  }
}

/** Debounced trigger for "a local write just happened". ~1s, per docs/sync.md. */
export function scheduleSync(): void {
  if (typeof window === "undefined") return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void syncAll(); }, 1000);
}

/**
 * Wires the background triggers: becoming visible, coming online, and a 60s
 * foreground interval. Call once from a client-only root component; returns
 * a cleanup function. No-ops on the server (no `window`).
 */
export function startSyncLoop(): () => void {
  if (typeof window === "undefined") return () => {};

  const onVisible = () => {
    if (document.visibilityState === "visible") void syncAll();
  };
  const onOnline = () => void syncAll();
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") void syncAll();
  }, 60000);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  void syncAll();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    clearInterval(interval);
  };
}
