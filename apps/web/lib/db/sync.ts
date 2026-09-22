import {
  SealError, createHlcState, hlcReceive, openOp, sealOp, type Op, type SealedOp,
} from "@bida/core";
import { started } from "../diag";
import { groupCrypto } from "../seal";
import { eraseGroupLocally } from "./commands/groups";
import { getDevice } from "./device";
import { db, type StoredOp, type Unreadable } from "./dexie";
import { VERSION } from "../version";
import { rebuild } from "./fold";
import { whenVisible } from "./visible";

/**
 * The sync engine (docs/sync.md). A single-flight push+pull per group over
 * the two `/api/groups/:id/ops` endpoints, triggered by local writes,
 * visibility, connectivity, and a slow foreground interval. Never blocks the
 * UI — every write already lands in Dexie synchronously via commands.ts;
 * this only ships the log to the server and pulls what's new.
 *
 * **This is the boundary the plaintext stops at.** Ops are plain in Dexie and
 * plain in every screen; the two lines below that seal and open them are the
 * whole of why the server holds ciphertext (ADR-0036). Anything that adds a
 * second path to the server has to come through here, or the guarantee the
 * about screen makes stops being true.
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
  /** Sealed: the server has never seen one of these open. */
  ops: SealedOp[];
  latestSeq: number;
}

/**
 * Push this group's unsynced ops and pull what's new, sealed both ways.
 *
 * The bearer is the derived token, not the secret in the link — handing the
 * secret over would let the server derive the key that opens everything it is
 * storing, which is the whole point of the exercise.
 */
async function pushPullGroup(
  groupId: string,
  secret: string,
  since: number,
  pending: readonly StoredOp[],
): Promise<{ response: PushPullResponse; pulled: Op[]; unreadable: number[] }> {
  const crypto = await groupCrypto(groupId, secret);
  const ops = await Promise.all(pending.map((op) => sealOp(crypto, {
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
  })));

  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${crypto.token}` },
    body: JSON.stringify({ ops, since }),
  });
  if (!res.ok) {
    throw new SyncHttpError(res.status, await res.text().catch(() => ""));
  }
  const response = (await res.json()) as PushPullResponse;
  // Opened before anything is stored, so a half-applied pull is not a state
  // this can reach. A *wrong key* never gets here — the token derived beside it
  // would have been a 403 — so a `SealError` means one row this build cannot
  // read. **Skip it and keep the rest**: failing the pull means the same row
  // comes back on every retry and sync never succeeds again. The likeliest way
  // to mint one is a newer build: an entity or op kind this one has never
  // heard of, or a second seal format. A stamp no clock could have written is
  // the other, and the one a peer can mint on purpose.
  const pulled: Op[] = [];
  const unreadable: number[] = [];
  for (const op of response.ops) {
    try {
      pulled.push(await openOp(crypto, op));
    } catch (err) {
      if (!(err instanceof SealError)) throw err;
      unreadable.push(op.seq ?? 0);
    }
  }
  return { response, pulled, unreadable };
}

/**
 * Everything the server holds for one group, opened and handed back without a
 * byte of it being stored. What `/delete-my-data` shows before it deletes.
 *
 * **Keep every key derivation in this file.** It is the boundary the plaintext
 * stops at, and a second place opening ops is how that guarantee stops being
 * one thing you can check. Read-only, and it may be a group this phone has
 * never held.
 *
 * Rejects with `SyncHttpError` — 404 is a group this server never had, 410 one
 * that was deleted, 403 a link whose secret is wrong.
 */
export async function pullWholeGroup(groupId: string, secret: string): Promise<Op[]> {
  const crypto = await groupCrypto(groupId, secret);
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/ops?since=0`, {
    headers: { Authorization: `Bearer ${crypto.token}` },
  });
  if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ""));
  const body = (await res.json()) as { ops: SealedOp[] };
  return Promise.all(body.ops.map((op) => openOp(crypto, op)));
}

/**
 * Delete a group from the server: every op, and the id along with them
 * (`DELETE /api/groups/:id`, docs/sync.md#deleting-a-group).
 *
 * The one request this app makes that destroys something, and it is
 * authenticated like every other one: by the token derived from the link
 * secret, which is the whole of authority here (ADR-0003). It does nothing
 * about this phone's own copy. That is `eraseGroupLocally`, and the screen
 * that asks for both is `/delete-my-data`.
 */
export async function deleteGroupOnServer(groupId: string, secret: string): Promise<void> {
  const crypto = await groupCrypto(groupId, secret);
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${crypto.token}` },
  });
  if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ""));
}

interface SyncOutcome {
  pushed: number;
  pulled: number;
}

/**
 * Remember that an attempt failed, so a screen can say so. Every caller of
 * `syncGroup` swallows the rejection somewhere, and a phone whose changes are
 * going nowhere otherwise looks identical to one that is up to date.
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

/**
 * Fold what this round had to skip into what earlier rounds did. The count
 * accumulates and `fromSeq` only ever goes down, because the earliest skipped
 * op is what a later, cleverer build would have to wind the cursor back to.
 * A round that skipped nothing leaves the record alone rather than clearing
 * it: the ops it could not read are still unread.
 */
function skipped(before: Unreadable | undefined, seqs: readonly number[]): Unreadable | undefined {
  if (seqs.length === 0) return before;
  return {
    count: (before?.count ?? 0) + seqs.length,
    fromSeq: Math.min(before?.fromSeq ?? Infinity, ...seqs),
    at: Date.now(),
    build: VERSION,
  };
}

/** One run per group at a time — see `syncGroup`. */
const inFlight = new Map<string, Promise<SyncOutcome | undefined>>();

/**
 * How many queued ops one push carries.
 *
 * Not what keeps the request legal — the server cuts a large push up for D1
 * itself and its `413` ceilings sit a hundredfold above this
 * (`apps/api/src/push-limits.ts`). This keeps the request *small*: a phone back
 * from a fortnight offline has hundreds of ops waiting, and as one body the
 * whole fortnight rides on a single request surviving a tunnel's worth of
 * signal. In rounds, what got through stays through.
 */
const PUSH_CHUNK = 50;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
 * calls this directly (app/g/page.tsx) and would otherwise race the loop's run
 * for the same group — every op pushed and pulled twice, and two `rebuild()`s
 * taking the readwrite lock on every table just as the screen waits to read.
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

  const queued = await d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).toArray();
  // One round with nothing to push is the plain pull — the case where this
  // phone has written nothing since it last synced, which is most of them.
  const rounds = queued.length > 0 ? chunk(queued, PUSH_CHUNK) : [[] as StoredOp[]];
  // Skipping an op is only safe because it is still on the server. The first
  // run of any build but the one that skipped it pulls again from the earliest
  // one, and starts the record afresh: whatever still will not open is written
  // down again, and what now opens lands. Once per build, not per run, so a
  // row nothing can read costs one re-pull per deploy rather than one a minute.
  let rewinding = key.unreadable !== undefined && key.unreadable.build !== VERSION;
  let since = rewinding
    ? Math.max(0, Math.min(key.lastSeq, key.unreadable!.fromSeq - 1))
    : key.lastSeq;
  let pushed = 0;
  let pulledCount = 0;

  for (const pending of rounds) {
    let sealed: { response: PushPullResponse; pulled: Op[]; unreadable: number[] };
    // The one step here that waits on a network rather than on this phone.
    const sent = started("sync.pushpull");
    try {
      sealed = await pushPullGroup(groupId, key.secret, since, pending);
    } catch (err) {
      sent("failed");
      // 410: somebody deleted this group (docs/sync.md#deleting-a-group). There
      // is nothing to retry and nothing to sync with ever again, so this phone's
      // copy goes too. That is what "deleted for everybody" has to mean, and a
      // group left sitting on the list syncing against a tombstone would be the
      // one place the app disagreed with itself.
      if (err instanceof SyncHttpError && err.status === 410) {
        await eraseGroupLocally(groupId);
        return undefined;
      }
      await recordFailure(groupId, err);
      throw err;
    }
    const { response: { assigned, latestSeq }, pulled, unreadable } = sealed;
    sent(`${pending.length} up, ${pulled.length} down`
      + (unreadable.length > 0 ? `, ${unreadable.length} unreadable` : ""));

    // The answer can land after the app has gone to the background — the
    // network after a resume is slow, and people leave. Nothing is lost by
    // waiting for the front: the response is held here, and a run killed while
    // parked is simply pulled again. See ./visible.ts for why it waits.
    await whenVisible("sync.commit");
    const committed = started("sync.commit");
    await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
      for (const op of pending) {
        const seq = assigned[op.id];
        if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
      }
      if (pulled.length > 0) {
        await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
        // Adopt every stamp we've just stored, so this device's next op sorts
        // after the ops it has seen. Without it the clock only moves on send:
        // correcting a peer's expense stamps the correction *before* the create
        // when that peer's phone runs fast, and the fold discards it — the
        // amount changes, then snaps back. In the same transaction as the ops
        // themselves, for the same reason `appendOps` advances it in its own: a
        // tab that dies here must not leave the clock trailing an op the log
        // already holds.
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
        unreadable: skipped(rewinding ? undefined : current?.unreadable, unreadable),
      });
    }).then(() => committed(), (err: unknown) => {
      committed("failed");
      throw err;
    });

    since = Math.max(latestSeq, since);
    rewinding = false;
    pushed += pending.length;
    pulledCount += pulled.length;
  }

  // A pulled op can slot in earlier than ops already folded locally — refold
  // the whole group rather than risk applying out of HLC order. See
  // docs/sync.md#gotchas. Once for the run, not once per round: it folds the
  // whole log, and a phone emptying a fortnight's queue would otherwise do
  // that on every fiftieth op.
  if (pulledCount > 0) {
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

  return { pushed, pulled: pulledCount };
}

let running: Promise<void> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
let backoffMs = 2000;
const BACKOFF_MAX_MS = 60000;

/**
 * Runs every group's sync once, sequentially. **Single-flight across the whole
 * run, not per group**: an overlapping call joins the run in flight instead of
 * starting a second one.
 *
 * Five things trigger this — a local write, visibility, `online`, the 60s
 * interval, and the backoff timer itself. Per group, the second caller skips
 * the groups already in flight, finishes with nothing attempted, then clears
 * the pending retry and resets the backoff to 2s: against a dead server it
 * never grows past its first step.
 */
export function syncAll(): Promise<void> {
  // Not while hidden, for the reason `whenVisible` gives. The debounce after a
  // write, `online` and the backoff can all fire in the background; coming
  // back to the front runs a sync anyway (`startSyncLoop`), so skipping here
  // only moves the attempt to the moment it is safe.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return running ?? Promise.resolve();
  }
  running ??= runSyncAll().finally(() => { running = undefined; });
  return running;
}

async function runSyncAll(): Promise<void> {
  const keys = await db().groupKeys.toArray();
  // A forgotten group keeps its secret — reopening the invite link un-forgets
  // it — but it stops costing cellular data in the meantime. Without this,
  // `forgetGroup` hides the row while its ops go on flowing in forever.
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
