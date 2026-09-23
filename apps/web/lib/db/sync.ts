import {
  MAX_DRIFT_MS, SealError, createHlcState, encryptPush, hlcReceive, isAhead, openOp, parseHlc,
  sealOp, toBase64,
  type Op, type SealedOp,
} from "@bida/core";
import { note, started } from "../diag";
import { pushMessages } from "../notify-copy";
import { groupCrypto } from "../seal";
import { eraseGroupLocally } from "./commands/groups";
import { getDevice } from "./device";
import { db, type StoredOp, type Unreadable } from "./dexie";
import { VERSION } from "../version";
import { groupState, rebuild } from "./fold";
import { whenVisible } from "./visible";

/**
 * The sync engine (docs/sync.md). A single-flight push+pull per group over
 * `/api/groups/:id/ops`, triggered by local writes, visibility, connectivity
 * and a slow foreground interval. Never blocks the UI — writes already land
 * in Dexie via commands.ts.
 *
 * **This is the boundary the plaintext stops at** (ADR-0036). Anything that
 * adds a second path to the server has to come through here, or the about
 * screen's guarantee stops being true.
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

interface PushPullResult {
  response: PushPullResponse;
  pulled: Op[];
  /** Seqs of the ops held back: unreadable to this build, or stamped too far ahead. */
  unreadable: number[];
  /** When the earliest op held back for its stamp stops being too far ahead. */
  retryAt?: number;
}

/**
 * Push this group's unsynced ops and pull what's new, sealed both ways. The
 * bearer is the derived token, never the link secret — that would let the
 * server derive the key to everything it stores.
 */
async function pushPullGroup(
  groupId: string,
  secret: string,
  since: number,
  pending: readonly StoredOp[],
): Promise<PushPullResult> {
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
  // Opened before anything is stored, so a half-applied pull can't happen. A
  // *wrong key* never gets here (its token would be a 403), so a `SealError` is
  // one row this build can't read — a newer build's kind or seal format, or an
  // impossible stamp a peer can mint on purpose. **Skip it and keep the rest**:
  // failing the pull would refetch it forever and sync would never succeed.
  //
  // A stamp more than a day ahead is held back the same way (`isAhead`): a fast
  // clock's op is late, not lost, and `retryAt` is when the cursor winds back.
  const now = Date.now();
  const pulled: Op[] = [];
  const unreadable: number[] = [];
  let retryAt: number | undefined;
  for (const op of response.ops) {
    let opened: Op;
    try {
      opened = await openOp(crypto, op);
    } catch (err) {
      if (!(err instanceof SealError)) throw err;
      unreadable.push(op.seq ?? 0);
      continue;
    }
    if (isAhead(opened.hlc, now)) {
      unreadable.push(op.seq ?? 0);
      const ready = parseHlc(opened.hlc).physical - MAX_DRIFT_MS;
      retryAt = Math.min(retryAt ?? Infinity, ready);
      continue;
    }
    pulled.push(opened);
  }
  return { response, pulled, unreadable, retryAt };
}

/**
 * Everything the server holds for one group, opened and returned without
 * storing a byte — what `/delete-my-data` shows before it deletes. Read-only;
 * may be a group this phone never held.
 *
 * **Keep every key derivation in this file**, so the plaintext boundary stays
 * one thing you can check.
 *
 * Rejects with `SyncHttpError`: 404 never had it, 410 deleted, 403 wrong secret.
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
 * Delete a group from the server: every op and the id
 * (`DELETE /api/groups/:id`, docs/sync.md#deleting-a-group). Authenticated by
 * the derived token like every request (ADR-0003). Leaves this phone's copy
 * alone — that is `eraseGroupLocally`; `/delete-my-data` asks for both.
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
 * Fold what this round skipped into earlier rounds' record. The count
 * accumulates and `fromSeq` only goes down: the earliest skipped op is where
 * a later build must wind back to. A round that skipped nothing leaves the
 * record alone — those ops are still unread.
 */
function skipped(
  before: Unreadable | undefined, seqs: readonly number[], retryAt: number | undefined,
): Unreadable | undefined {
  if (seqs.length === 0) return before;
  const earliest = Math.min(before?.retryAt ?? Infinity, retryAt ?? Infinity);
  return {
    count: (before?.count ?? 0) + seqs.length,
    fromSeq: Math.min(before?.fromSeq ?? Infinity, ...seqs),
    at: Date.now(),
    build: VERSION,
    ...(Number.isFinite(earliest) ? { retryAt: earliest } : {}),
  };
}

/**
 * Whether the ops a record holds back may read differently now: to a build
 * other than the one that skipped them, or — for one held back for its stamp —
 * once the wall has caught up with it.
 */
function worthAnotherLook(record: Unreadable | undefined, now: number): record is Unreadable {
  if (!record) return false;
  return record.build !== VERSION || (record.retryAt !== undefined && now >= record.retryAt);
}

/** One run per group at a time — see `syncGroup`. */
const inFlight = new Map<string, Promise<SyncOutcome | undefined>>();

/**
 * How many queued ops one push carries. Not what keeps the request legal (the
 * server's `413` ceilings are far above this, `apps/api/src/push-limits.ts`) —
 * what keeps it *small*: a phone back from a fortnight offline shouldn't bet
 * it all on one request surviving a tunnel. In rounds, what got through stays.
 */
const PUSH_CHUNK = 50;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Push this device's unsynced ops for one group and pull what it hasn't seen.
 * Returns `undefined` if this device doesn't hold the group's secret.
 *
 * Rejects on failure, having recorded it on the group's key first — callers
 * may ignore the rejection; the UI reads the record.
 *
 * Single-flight per group: opening a group calls this directly
 * (app/g/page.tsx) and would otherwise race `syncAll` — every op pushed and
 * pulled twice, and two `rebuild()`s holding the write lock as the screen
 * waits to read.
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
  // Skipping is only safe because the op is still on the server. The first run
  // of a different build — or once a held-back stamp stops being ahead — pulls
  // again from the earliest skipped op and starts the record afresh. Not every
  // run: an unreadable row costs one re-pull per deploy, not one a minute.
  let rewinding = worthAnotherLook(key.unreadable, Date.now());
  let since = rewinding
    ? Math.max(0, Math.min(key.lastSeq, key.unreadable!.fromSeq - 1))
    : key.lastSeq;
  let pushed = 0;
  let pulledCount = 0;

  for (const pending of rounds) {
    let sealed: PushPullResult;
    // The one step here that waits on a network rather than on this phone.
    const sent = started("sync.pushpull");
    try {
      sealed = await pushPullGroup(groupId, key.secret, since, pending);
    } catch (err) {
      sent("failed");
      // 410: somebody deleted this group (docs/sync.md#deleting-a-group). Nothing
      // to retry, ever, so this phone's copy goes too — that is what "deleted for
      // everybody" means.
      if (err instanceof SyncHttpError && err.status === 410) {
        await eraseGroupLocally(groupId);
        return undefined;
      }
      await recordFailure(groupId, err);
      throw err;
    }
    const { response: { assigned, latestSeq }, pulled, unreadable, retryAt } = sealed;
    sent(`${pending.length} up, ${pulled.length} down`
      + (unreadable.length > 0 ? `, ${unreadable.length} unreadable` : ""));

    // The answer can land after the app has gone to the background. The response
    // is held here, and a run killed while parked is pulled again. See
    // ./visible.ts for why it waits.
    await whenVisible("sync.commit");
    const committed = started("sync.commit");
    await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
      for (const op of pending) {
        const seq = assigned[op.id];
        if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
      }
      if (pulled.length > 0) {
        await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
        // Adopt every stamp just stored, so this device's next op sorts after them.
        // Otherwise correcting a fast-clocked peer's expense stamps the correction
        // *before* the create and the fold discards it — the amount snaps back. Same
        // transaction as the ops, like `appendOps`: a tab dying here must not leave
        // the clock behind the log.
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
        // A group this phone never showed edits for starts with none to show:
        // what it pulls on joining is the group's past, not news.
        seenSeq: current?.seenSeq ?? Math.max(latestSeq, current?.lastSeq ?? 0),
        lastSyncedAt: Date.now(),
        failure: undefined,
        unreadable: skipped(rewinding ? undefined : current?.unreadable, unreadable, retryAt),
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

  // Only now: a notification about an op still on this phone would open to
  // nothing on the phone it reaches. Its own failures are its own.
  await sendNotices(groupId, key.secret).catch((err: unknown) => note("notify", errorOf(err)));

  // A pulled op can slot in before ops already folded — refold the whole group
  // rather than apply out of HLC order (docs/sync.md#gotchas). Once per run, not
  // per round: it folds the whole log.
  if (pulledCount > 0) {
    await rebuild(groupId);
    // A merge is the only thing that can produce an illegal state (local writes
    // are refused first), so healing belongs here. It writes ops the next run
    // pushes. Imported lazily: the command layer imports this file, and a static
    // import would close the cycle.
    const { healGroup } = await import("./commands/groups");
    // Up to eight passes, each folding the whole log — worth its own line.
    const healed = started("heal");
    await healGroup(groupId).then((n) => healed(`${n} ops`), () => healed("failed"));
  }

  return { pushed, pulled: pulledCount };
}

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `/notify`'s cap per request — the Worker's `MAX_NOTIFY_PER_BATCH`. */
const NOTIFY_BATCH = 40;

/** A push service's verdict that a subscription is gone for good (RFC 8030). */
const DEAD = new Set([404, 410]);

/**
 * Send what this phone's commands owe the group, once their ops are on the
 * server (docs/notifications.md): each device's notification encrypted to its
 * own subscription (RFC 8291), so the Worker relays ciphertext it cannot read,
 * in batches it can fit under its subrequest cap.
 *
 * Never fails the sync — the ops are in. The notices are dropped once every
 * batch is answered; a network error or a 5xx keeps them for the next run, at
 * the cost of a repeat on the batches that did go, which the group's `tag`
 * folds into one notification. A device whose push service says it is gone
 * gets `push: null`, written by this phone for it.
 */
async function sendNotices(groupId: string, secret: string): Promise<void> {
  const d = db();
  const records = await d.notices.where("groupId").equals(groupId).toArray();
  if (records.length === 0) return;
  const ready = [];
  for (const record of records) {
    const ops = await d.ops.bulkGet(record.opIds);
    if (ops.every((op) => !op || op.pending === 0)) ready.push(record);
  }
  if (ready.length === 0) return;

  const done = started("notify");
  const [state, device] = await Promise.all([groupState(groupId), getDevice()]);
  const messages = pushMessages(state, ready.flatMap((r) => r.notices), groupId, device.nodeId);
  const utf8 = new TextEncoder();
  const sealed = (await Promise.all(messages.map(async (m) => {
    try {
      const body = await encryptPush(m.push, utf8.encode(JSON.stringify(m.payload)));
      return { message: m, endpoint: m.push.endpoint, body: toBase64(body) };
    } catch {
      // Anyone with the link can write a subscription; a broken one is skipped.
      return undefined;
    }
  }))).filter((s) => s !== undefined);

  const crypto = await groupCrypto(groupId, secret);
  const statuses: Record<string, number> = {};
  let answered = true;
  for (let i = 0; i < sealed.length; i += NOTIFY_BATCH) {
    const batch = sealed.slice(i, i + NOTIFY_BATCH);
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${crypto.token}` },
        body: JSON.stringify({ notifications: batch.map(({ endpoint, body }) => ({ endpoint, body })) }),
      });
      if (res.status >= 500) answered = false;
      if (res.ok) Object.assign(statuses, ((await res.json()) as { notified: Record<string, number> }).notified);
    } catch {
      answered = false;
    }
  }
  if (answered) await d.notices.bulkDelete(ready.map((r) => r.id));
  done(`${sealed.length} sent${answered ? "" : ", kept"}`);

  // Only a subscription the log still holds: a phone that re-subscribed since
  // has a new endpoint, which this must not wipe.
  const me = device.meByGroup[groupId];
  const dead = sealed.filter((s) => DEAD.has(statuses[s.endpoint] ?? 0)
    && state.identities[s.message.identity.id]?.push?.endpoint === s.endpoint);
  if (me && dead.length > 0) {
    const { appendOps } = await import("./commands/append");
    await appendOps(groupId, me, dead.map((s) => ({
      entity: "identity" as const, entityId: s.message.identity.id, kind: "update" as const,
      patch: { push: null },
    })));
  }
}

let running: Promise<void> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
let backoffMs = 2000;
const BACKOFF_MAX_MS = 60000;

/**
 * Runs every group's sync once, sequentially. **Single-flight across the whole
 * run, not per group**: an overlapping call joins the run in flight. Per group,
 * a second caller would find everything in flight, attempt nothing, and reset
 * the backoff to 2s — against a dead server it would never grow.
 */
export function syncAll(): Promise<void> {
  // Not while hidden (see `whenVisible`). Coming to the front runs a sync anyway
  // (`startSyncLoop`), so this only moves the attempt to when it is safe.
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
  // `forgetGroup` hides the row while its ops go on flowing in forever. Bar
  // its last ops: the `push: null` that stops it buzzing this phone.
  const left = new Set((await getDevice()).leftGroups ?? []);
  let anyFailure = false;
  for (const key of keys) {
    if (left.has(key.groupId) && !(await hasPending(key.groupId))) continue;
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

async function hasPending(groupId: string): Promise<boolean> {
  return (await db().ops.where("groupId").equals(groupId).and((op) => op.pending === 1).count()) > 0;
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
