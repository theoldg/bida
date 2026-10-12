import {
  MAX_DRIFT_MS, SealError, createHlcState, encryptPush, hlcReceive, isAhead, openOp, parseHlc,
  chunk, sealOp, toBase64,
  type GroupCrypto, type Op, type SealedOp,
} from "@bida/core";
import { keepNote, started } from "../diag";
import { errorText } from "../format";
import { pushMessages } from "../notify-copy";
import { groupCrypto } from "../seal";
import { dropForgotten, eraseGroupLocally } from "./commands/groups";
import { getDevice } from "./device";
import { db, type StoredOp, type Unreadable } from "./dexie";
import { VERSION } from "../version";
import { groupState, rebuild } from "./fold";
import { whenVisible } from "./visible";
import { leaveCursor, stashKey, stashes } from "./stash";

/**
 * The sync engine (docs/sync.md): single-flight push+pull per group.
 *
 * **This is the boundary the plaintext stops at** (ADR-0036): a second path to
 * the server comes through here, or the about screen's guarantee stops being
 * true.
 */

/**
 * A refused sync. 403 — the secret doesn't match — is the one failure retrying
 * never fixes.
 */
export class SyncHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`sync failed: ${status} ${body}`);
    this.name = "SyncHttpError";
  }
}

interface PushPullResponse {
  assigned: Record<string, number>;
  ops: SealedOp[];
  latestSeq: number;
}

interface PushPullResult {
  response: PushPullResponse;
  pulled: Op[];
  /** Seqs held back: unreadable to this build, or stamped too far ahead. */
  unreadable: number[];
  retryAt?: number;
}

/**
 * The bearer is the derived token, never the link secret, which would let the
 * server derive the key.
 */
/**
 * A request the app went to the background on can stay pending with its
 * connection gone, holding every run queued behind it. A repeated push is
 * harmless: the op id is the idempotency key.
 */
const SYNC_PATIENCE_MS = 30_000;

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
    signal: AbortSignal.timeout(SYNC_PATIENCE_MS),
  });
  if (!res.ok) {
    throw new SyncHttpError(res.status, await res.text().catch(() => ""));
  }
  const response = (await res.json()) as PushPullResponse;
  return { response, ...(await openPulled(crypto, response.ops)) };
}

/**
 * Open the pull before storing any of it. A `SealError` is one row this build
 * can't read (a wrong key would have been a 403): **skip it and keep the rest**,
 * or the pull refetches it forever. A stamp over a day ahead is held back the
 * same way, late rather than lost.
 */
async function openPulled(
  crypto: GroupCrypto, sealed: readonly SealedOp[],
): Promise<Omit<PushPullResult, "response">> {
  const now = Date.now();
  const pulled: Op[] = [];
  const unreadable: number[] = [];
  let retryAt: number | undefined;
  for (const op of sealed) {
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
  return { pulled, unreadable, retryAt };
}

/**
 * Everything the server holds for one group, opened and never stored — what
 * `/delete-my-data` shows. **Keep every key derivation in this file.** Rejects:
 * 404 never had it, 410 deleted, 403 wrong secret.
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

/** Leaves this phone's copy alone — that is `eraseGroupLocally`. */
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
 * Every caller swallows the rejection, and a phone whose changes go nowhere
 * otherwise looks up to date.
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
 * `fromSeq` only goes down: the earliest skipped op is where a later build winds
 * back to.
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

function worthAnotherLook(record: Unreadable | undefined, now: number): record is Unreadable {
  if (!record) return false;
  return record.build !== VERSION || (record.retryAt !== undefined && now >= record.retryAt);
}

/**
 * Adopts every stamp stored, so this device's next op sorts after them — or a
 * correction to a fast-clocked peer's expense folds before its create, and the
 * amount snaps back. Same transaction as the ops.
 */
async function storePulled(pulled: readonly Op[]): Promise<void> {
  const d = db();
  await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
  const device = await getDevice();
  const now = Date.now();
  let clock = createHlcState(device.nodeId, device.hlcPhysical, device.hlcCounter);
  for (const op of pulled) clock = hlcReceive(clock, op.hlc, now);
  await d.device.put({
    ...device, hlcPhysical: clock.physical, hlcCounter: clock.counter,
  });
}

const inFlight = new Map<string, Promise<SyncOutcome | undefined>>();

/**
 * Not the server's ceiling, which is far above: a phone back from a fortnight
 * offline shouldn't bet everything on one request. In rounds, what got through
 * stays.
 */
const PUSH_CHUNK = 50;

/**
 * Resolves `undefined` without the group's secret; rejects having recorded the
 * failure, which the UI reads. Single-flight per group, or opening a group races
 * `syncAll`: every op twice, two `rebuild()`s holding the write lock.
 */
export function syncGroup(groupId: string): Promise<SyncOutcome | undefined> {
  const already = inFlight.get(groupId);
  if (already && !stale.has(already)) return already;
  // One from before the app went away pulled too early to count: run behind it.
  const run: Promise<SyncOutcome | undefined> = (already
    ? already.catch(() => undefined).then(() => syncGroupOnce(groupId))
    : syncGroupOnce(groupId)
  ).finally(() => { if (inFlight.get(groupId) === run) inFlight.delete(groupId); });
  inFlight.set(groupId, run);
  return run;
}

/**
 * Runs in flight when the app last came to the front; each began before it went
 * away.
 */
const stale = new WeakSet<Promise<unknown>>();

function markInFlightStale(): void {
  for (const run of inFlight.values()) stale.add(run);
  if (running) stale.add(running);
}

async function syncGroupOnce(groupId: string): Promise<SyncOutcome | undefined> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return undefined;

  const queued = await d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).toArray();
  const rounds = queued.length > 0 ? chunk(queued, PUSH_CHUNK) : [[] as StoredOp[]];
  // Skipping is safe only because the op is still on the server. A different
  // build, or a held-back stamp no longer ahead, re-pulls from the earliest
  // skipped op: once per deploy, not once a minute.
  let rewinding = worthAnotherLook(key.unreadable, Date.now());
  let since = rewinding
    ? Math.max(0, Math.min(key.lastSeq, key.unreadable!.fromSeq - 1))
    : key.lastSeq;
  let pushed = 0;
  let pulledCount = 0;

  for (const pending of rounds) {
    let sealed: PushPullResult;
    const sent = started("sync.pushpull");
    try {
      sealed = await pushPullGroup(groupId, key.secret, since, pending);
    } catch (err) {
      sent("failed");
      await whenVisible("sync.failed");
      // 410: deleted for everybody, so this phone's copy goes too.
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

    // The answer can land after the app went to the background (./visible.ts).
    await whenVisible("sync.commit");
    const committed = started("sync.commit");
    const kept = await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
      // Forgotten and erased while the request was out: storing would put back
      // half a group.
      const current = await d.groupKeys.get(groupId);
      if (!current) return false;
      for (const op of pending) {
        const seq = assigned[op.id];
        if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
      }
      if (pulled.length > 0) {
        await storePulled(pulled);
      }
      await d.groupKeys.put({
        ...current,
        groupId,
        secret: key.secret,
        lastSeq: Math.max(latestSeq, current.lastSeq),
        // What a phone pulls on joining is the group's past, not news.
        seenSeq: current.seenSeq ?? Math.max(latestSeq, current.lastSeq),
        lastSyncedAt: Date.now(),
        failure: undefined,
        unreadable: skipped(rewinding ? undefined : current.unreadable, unreadable, retryAt),
      });
      return true;
    }).then((stored) => { committed(); return stored; }, (err: unknown) => {
      committed("failed");
      throw err;
    });
    if (!kept) return undefined;

    since = Math.max(latestSeq, since);
    rewinding = false;
    pushed += pending.length;
    pulledCount += pulled.length;
  }

  await leaveCursor(groupId, key.secret, since).catch((err: unknown) => keepNote("stash", errorText(err)));

  // Only now: a notification about an op still on this phone would open to
  // nothing.
  await sendNotices(groupId, key.secret).catch((err: unknown) => keepNote("notify", errorText(err)));

  if ((await getDevice()).leftGroups?.includes(groupId) && await dropForgotten(groupId)) {
    return { pushed, pulled: pulledCount };
  }

  // A pulled op can sort before folded ones, so refold the group
  // (docs/sync.md#folding), once per run.
  if (pulledCount > 0) await rebuild(groupId);
  // Also on a group's first sync of the session: an older build's writes can owe
  // a repair.
  if (pulledCount > 0 || !healedThisSession.has(groupId)) {
    healedThisSession.add(groupId);
    // Only a merge or an older build produces an illegal state, so healing lives
    // here. Imported lazily to break the cycle with the command layer.
    const { healGroup } = await import("./commands/groups");
    const healed = started("heal");
    await healGroup(groupId).then((n) => healed(`${n} ops`), () => healed("failed"));
  }

  return { pushed, pulled: pulledCount };
}


/** In memory: a reload heals again, which costs one fold. */
const healedThisSession = new Set<string>();

const applying = new Map<string, Promise<void>>();

/**
 * Store and fold what the worker pulled ahead, so the screen draws the group
 * current. Never throws: the ordinary pull is right behind it.
 */
export function applyStash(groupId: string): Promise<void> {
  let run = applying.get(groupId);
  if (!run) {
    run = applyStashOnce(groupId)
      .catch((err: unknown) => keepNote("stash", errorText(err)))
      .finally(() => { applying.delete(groupId); });
    applying.set(groupId, run);
  }
  return run;
}

async function applyStashOnce(groupId: string): Promise<void> {
  const cache = await stashes();
  const res = await cache?.match(stashKey(groupId));
  if (!cache || !res) return;
  // Deleted first: a stash that fails to apply would fail on every open.
  await cache.delete(stashKey(groupId));
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return;
  const { ops } = (await res.json()) as PushPullResponse;
  const { pulled } = await openPulled(await groupCrypto(groupId, key.secret), ops);
  const held = await d.ops.bulkGet(pulled.map((op) => op.id));
  const fresh = pulled.filter((_, i) => !held[i]);
  if (fresh.length === 0) return;

  await whenVisible("stash.commit");
  const done = started("stash", `${fresh.length} ops`);
  const stored = await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
    if (!(await d.groupKeys.get(groupId))) return false;
    await storePulled(fresh);
    return true;
  });
  if (stored) await rebuild(groupId);
  done(stored ? undefined : "gone");
}

/** The Worker's `MAX_NOTIFY_PER_BATCH`. */
const NOTIFY_BATCH = 40;

/** RFC 8030: the subscription is gone for good. */
const DEAD = new Set([404, 410]);

/**
 * Each device's notification encrypted to its own subscription (RFC 8291), so the
 * Worker relays ciphertext. Never fails the sync. A network error or 5xx keeps
 * the notices for the next run; the group's `tag` folds a repeat into one
 * notification.
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
        signal: AbortSignal.timeout(SYNC_PATIENCE_MS),
      });
      if (res.status >= 500) answered = false;
      if (res.ok) Object.assign(statuses, ((await res.json()) as { notified: Record<string, number> }).notified);
    } catch {
      answered = false;
    }
  }
  await whenVisible("notify.commit");
  if (answered) await d.notices.bulkDelete(ready.map((r) => r.id));
  done(`${sealed.length} sent${answered ? "" : ", kept"}`);

  // A phone that re-subscribed since has a new endpoint, which this must not
  // wipe.
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
 * **Single-flight across the whole run, not per group**: per group, a second
 * caller would attempt nothing and reset the backoff, which against a dead server
 * would never grow. A run the app went to the background during is stale, and
 * queues a fresh pass instead.
 */
export function syncAll(): Promise<void> {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return running ?? Promise.resolve();
  }
  if (running && !stale.has(running)) return running;
  const before = running;
  const run: Promise<void> = (before ? before.catch(() => undefined).then(runSyncAll) : runSyncAll())
    .finally(() => { if (running === run) running = undefined; });
  running = run;
  return run;
}

async function runSyncAll(): Promise<void> {
  const keys = await byRecency(await db().groupKeys.toArray());
  // A forgotten group still here has ops to push; one with none left is erased
  // without asking the server.
  const left = new Set((await getDevice()).leftGroups ?? []);
  // All at once: in turn, six groups were the seconds a reopened app took to show
  // news in the fifth.
  const results = await Promise.allSettled(keys.map(async (key) => {
    if (left.has(key.groupId) && !(await hasPending(key.groupId))) {
      await dropForgotten(key.groupId);
      return;
    }
    await syncGroup(key.groupId);
  }));
  const anyFailure = results.some((r) => r.status === "rejected");

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

async function byRecency<T extends { groupId: string }>(keys: T[]): Promise<T[]> {
  const ops = db().ops;
  const newest = await Promise.all(keys.map(async (key) =>
    (await ops.where("[groupId+hlc]").between([key.groupId, ""], [key.groupId, "\uffff"]).last())?.hlc ?? ""));
  return keys
    .map((key, i) => ({ key, hlc: newest[i]! }))
    .sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0))
    .map(({ key }) => key);
}

/**
 * A screen applies its own group's stash on mounting; this covers one already
 * open, and the groups list.
 */
export async function applyStashes(): Promise<void> {
  const keys = await db().groupKeys.toArray().catch(() => []);
  await Promise.all(keys.map((key) => applyStash(key.groupId)));
}

async function hasPending(groupId: string): Promise<boolean> {
  return (await db().ops.where("groupId").equals(groupId).and((op) => op.pending === 1).count()) > 0;
}

const written = new Set<string>();

/**
 * Debounced, **for that group only**: the others have nothing to push. A failure
 * hands over to `syncAll`'s backoff.
 */
export function scheduleSync(groupId: string): void {
  if (typeof window === "undefined") return;
  written.add(groupId);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (document.visibilityState === "hidden") return;
    const ids = [...written];
    written.clear();
    void Promise.all(ids.map((id) => syncGroup(id))).catch(() => syncAll());
  }, 1000);
}

export const TICK_MS = 60_000;
export const SWEEP_MS = 5 * 60_000;
export const IDLE_MS = 5 * 60_000;

/**
 * Polling every group every minute made one person's day cost a thousand
 * requests. The group on screen stays a minute fresh; the rest wait for the
 * sweep, a resume or a write; idle polls nothing.
 */
export function planTick(
  now: number, lastInput: number, lastSweep: number, onScreen: string | null,
): { all: true } | { groupId: string } | null {
  if (now - lastInput >= IDLE_MS) return null;
  if (now - lastSweep >= SWEEP_MS) return { all: true };
  return onScreen ? { groupId: onScreen } : null;
}

export function groupOnScreen(location: { pathname: string; search: string }): string | null {
  return /^\/g(\/|$)/.test(location.pathname)
    ? new URLSearchParams(location.search).get("id")
    : null;
}

/**
 * Visible, online, the first touch after idling, and the tick. Returns a cleanup.
 */
export function startSyncLoop(): () => void {
  if (typeof window === "undefined") return () => {};

  let lastInput = Date.now();
  let lastSweep = 0;
  const sweep = () => {
    lastSweep = Date.now();
    void syncAll();
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    lastInput = Date.now();
    markInFlightStale();
    // Alongside, not before: neither moves the other's cursor.
    void applyStashes();
    sweep();
  };
  const onInput = () => {
    const now = Date.now();
    if (now - lastInput >= IDLE_MS) sweep();
    lastInput = now;
  };
  const interval = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const plan = planTick(Date.now(), lastInput, lastSweep, groupOnScreen(window.location));
    if (!plan) return;
    if ("all" in plan) sweep();
    else void syncGroup(plan.groupId).catch(() => {});
  }, TICK_MS);

  const inputs = ["pointerdown", "keydown", "wheel"] as const;
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", sweep);
  for (const type of inputs) window.addEventListener(type, onInput, { capture: true, passive: true });
  void applyStashes();
  sweep();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", sweep);
    for (const type of inputs) window.removeEventListener(type, onInput, { capture: true });
    clearInterval(interval);
  };
}
