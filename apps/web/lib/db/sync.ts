import {
  MAX_DRIFT_MS, SealError, createHlcState, encryptPush, fromBase64, hlcReceive, isAhead, openOp, openPhoto,
  parseHlc, chunk, sealOp, sealPhoto, toBase64,
  type GroupCrypto, type Op, type SealedOp,
} from "@bida/core";
import { keepNote, started } from "../diag";
import { errorText } from "../format";
import { pushMessages } from "../notify-copy";
import { groupCrypto } from "../seal";
import { dropForgotten, eraseGroupLocally } from "./commands/groups";
import { getDevice } from "./device";
import { db, type StoredOp, type StoredPhoto, type Unreadable } from "./dexie";
import { VERSION } from "../version";
import { groupState, rebuild } from "./fold";
import { whenVisible } from "./visible";
import { leaveCursor, stashKey, stashes } from "./stash";

/**
 * The plaintext stops here (ADR-0036): a second path to the server breaks the
 * about screen's guarantee. docs/sync.md.
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
  /** The page's end: everything up to it is in this answer or held already. */
  latestSeq: number;
  /** The log goes on past `latestSeq`; ask again from there. */
  more?: boolean;
  /** Where the group's log ends, for saying how far a walk has got. */
  head?: number;
}

interface PushPullResult {
  response: PushPullResponse;
  pulled: Op[];
  unreadable: number[];
  retryAt?: number;
}

/**
 * The bearer is the derived token, never the secret, which would yield the key.
 */
/**
 * A request left pending by backgrounding holds every run behind it; a repeated
 * push is harmless, the op id being the idempotency key.
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
 * A row this build can't read is skipped and the rest kept, or the pull refetches
 * it forever; a stamp over a day ahead is held back the same way.
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
 * Opened and never stored, for `/delete-my-data`. Keep every key derivation in
 * this file.
 */
export async function pullWholeGroup(groupId: string, secret: string): Promise<Op[]> {
  const crypto = await groupCrypto(groupId, secret);
  const ops: Op[] = [];
  for (let since = 0; ;) {
    const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/ops?since=${since}`, {
      headers: { Authorization: `Bearer ${crypto.token}` },
      signal: AbortSignal.timeout(SYNC_PATIENCE_MS),
    });
    if (!res.ok) throw new SyncHttpError(res.status, await res.text().catch(() => ""));
    const body = (await res.json()) as Omit<PushPullResponse, "assigned">;
    ops.push(...await Promise.all(body.ops.map((op) => openOp(crypto, op))));
    if (!body.more || body.latestSeq <= since) return ops;
    since = body.latestSeq;
  }
}

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
 * Every caller swallows the rejection; without this a stuck phone looks up to
 * date.
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
 * Adopts every stamp stored, or a correction to a fast-clocked peer's expense
 * folds before its create.
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
 * Not the server's ceiling: a phone back from a fortnight offline shouldn't bet
 * everything on one request. A round is one row on the server (`BATCH_OPS`), so
 * an import costs a write per two hundred entries.
 */
const PUSH_CHUNK = 200;

/**
 * Single-flight per group, or opening a group races `syncAll`: every op twice.
 */
export function syncGroup(groupId: string): Promise<SyncOutcome | undefined> {
  const already = inFlight.get(groupId);
  if (already && !stale.has(already)) return already;
  const run: Promise<SyncOutcome | undefined> = (already
    ? already.catch(() => undefined).then(() => syncGroupWalked(groupId))
    : syncGroupWalked(groupId)
  ).finally(() => { if (inFlight.get(groupId) === run) inFlight.delete(groupId); });
  inFlight.set(groupId, run);
  return run;
}

const stale = new WeakSet<Promise<unknown>>();

function markInFlightStale(): void {
  for (const run of inFlight.values()) stale.add(run);
  if (running) stale.add(running);
}

/**
 * How far a run walking the log in pages has got — seqs past where it started,
 * of those up to the head — for `/join` to count rather than shrug. Only once a
 * page says there is more, so a pull of one page says nothing; and until the
 * run ends, since the rebuild after its last page is what a join waits on too.
 */
export interface PullProgress { done: number; total: number }

const walking = new Map<string, PullProgress>();
const walkWatchers = new Set<() => void>();

export function pullProgress(groupId: string): PullProgress | undefined {
  return walking.get(groupId);
}

export function watchPullProgress(listener: () => void): () => void {
  walkWatchers.add(listener);
  return () => { walkWatchers.delete(listener); };
}

function walked(groupId: string, progress: PullProgress | undefined): void {
  if (progress) walking.set(groupId, progress);
  else if (!walking.delete(groupId)) return;
  for (const listener of walkWatchers) listener();
}

function syncGroupWalked(groupId: string): Promise<SyncOutcome | undefined> {
  return syncGroupOnce(groupId).finally(() => walked(groupId, undefined));
}

async function syncGroupOnce(groupId: string): Promise<SyncOutcome | undefined> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return undefined;

  // By the index: the waiting ops, never a walk of the whole log.
  const queued = await d.ops.where("[groupId+pending]").equals([groupId, 1]).toArray();
  // In the order they were written, not the index's (random ids): a group's
  // `create` goes up first, so a phone joining mid-import has the group to
  // open rather than thousands of entries in nothing.
  queued.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
  const rounds = chunk(queued, PUSH_CHUNK);
  // Skipping is safe only because the op is still on the server; a new build
  // re-pulls from the earliest skipped op, once per deploy.
  let rewinding = worthAnotherLook(key.unreadable, Date.now());
  let since = rewinding
    ? Math.max(0, Math.min(key.lastSeq, key.unreadable!.fromSeq - 1))
    : key.lastSeq;
  const from = since;
  let pushed = 0;
  let pulledCount = 0;
  // Every round pushes the next chunk, if any, and pulls the next page, until
  // neither is left: a page is what one request can carry on a slow link.
  const pushedIds = new Set<string>();
  // A push whose answer was lost (a reload, a timeout) comes back in a page
  // while still queued here. The server looks for a re-push only past the
  // cursor, which that page just moved beyond it: sent again, it is stored twice.
  const pulledIds = new Set<string>();
  let behind = true;

  for (let round = 0; round < rounds.length || behind; round++) {
    const pending = (rounds[round] ?? []).filter((op) => !pulledIds.has(op.id));
    let sealed: PushPullResult;
    const sent = started("sync.pushpull");
    try {
      sealed = await pushPullGroup(groupId, key.secret, since, pending);
    } catch (err) {
      sent("failed");
      await whenVisible("sync.failed");
      if (err instanceof SyncHttpError && err.status === 410) {
        await eraseGroupLocally(groupId);
        return undefined;
      }
      await recordFailure(groupId, err);
      throw err;
    }
    const { response: { assigned, latestSeq, more, head }, unreadable, retryAt } = sealed;
    for (const op of pending) pushedIds.add(op.id);
    // An earlier round's push comes back in a later page when the phone was behind.
    const pulled = sealed.pulled.filter((op) => !pushedIds.has(op.id));
    for (const op of pulled) pulledIds.add(op.id);
    sent(`${pending.length} up, ${pulled.length} down`
      + (unreadable.length > 0 ? `, ${unreadable.length} unreadable` : ""));

    await whenVisible("sync.commit");
    const committed = started("sync.commit");
    const kept = await d.transaction("rw", [d.ops, d.groupKeys, d.device], async () => {
      // Erased while the request was out: storing would put back half a group.
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
        // What a phone pulls on joining is the group's past, not news — all of
        // it, so a join's later pages too.
        seenSeq: current.seenSeq ?? (more ? undefined : Math.max(latestSeq, current.lastSeq)),
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

    // A page that moved nothing is a server saying more and meaning none.
    behind = more === true && latestSeq > since;
    since = Math.max(latestSeq, since);
    rewinding = false;
    // The last page too, once counting: the rebuild waits at full, not short.
    if (head !== undefined && head > from && (behind || walking.has(groupId))) {
      walked(groupId, { done: since - from, total: head - from });
    }
    pushed += pending.length;
    pulledCount += pulled.length;
  }

  // After the ops: the push registers a new group, and a photo is useless
  // without the op naming it. Never fails the sync — the ledger doesn't wait
  // on a picture.
  await syncPhotos(groupId, key.secret, pulledCount > 0)
    .catch((err: unknown) => keepNote("photos", errorText(err)));

  await leaveCursor(groupId, key.secret, since).catch((err: unknown) => keepNote("stash", errorText(err)));

  // Only now: a notification about an op still on this phone would open to
  // nothing.
  await sendNotices(groupId, key.secret).catch((err: unknown) => keepNote("notify", errorText(err)));

  if ((await getDevice()).leftGroups?.includes(groupId) && await dropForgotten(groupId)) {
    return { pushed, pulled: pulledCount };
  }

  if (pulledCount > 0) await rebuild(groupId);
  // Also on a first sync of the session: an older build's writes can owe a
  // repair.
  if (pulledCount > 0 || !healedThisSession.has(groupId)) {
    healedThisSession.add(groupId);
    // Lazy, to break the cycle with the command layer.
    const { healGroup } = await import("./commands/groups");
    const healed = started("heal");
    await healGroup(groupId).then((n) => healed(`${n} ops`), () => healed("failed"));
  }

  return { pushed, pulled: pulledCount };
}


// ------------------------------------------------------------- kept photos

const photoUrl = (groupId: string, photoId: string) =>
  `/api/groups/${encodeURIComponent(groupId)}/photos/${encodeURIComponent(photoId)}`;

const HOUR = 3_600_000;
/** A full month, a full group or a full bucket lifts slowly; a server without photos sooner. */
const RETRY_AFTER: Record<number, number> = { 503: HOUR, 507: 6 * HOUR };

/**
 * Upload what this phone kept, drop what it gave up, and forget photos other
 * phones dropped. Sealed here, beside the ops, for the same reason
 * (docs/photos.md): the plaintext never leaves this file.
 */
async function syncPhotos(groupId: string, secret: string, pulled: boolean): Promise<void> {
  const d = db();
  const now = Date.now();
  const due = (await d.photos.where("[groupId+state]").anyOf([[groupId, "upload"], [groupId, "delete"]]).toArray())
    .filter((p) => !p.stuck && (p.retryAt ?? 0) <= now)
    // A replacement lands before the photo it replaces goes.
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "upload" ? -1 : 1));
  if (due.length > 0) {
    const crypto = await groupCrypto(groupId, secret);
    for (const photo of due) {
      if (!(await sendPhoto(crypto, photo))) break;
    }
  }
  // Keys only: a held row carries its photo, and there may be hundreds.
  if (pulled) {
    const held = await d.photos.where("[groupId+state]").equals([groupId, "held"]).primaryKeys();
    const records = await d.attachments.bulkGet(held);
    const gone = held.filter((_, i) => records[i]?.deletedAt);
    if (gone.length > 0) await d.photos.bulkDelete(gone);
  }
}

/** False when the server can't be reached, or the group is gone: the rest waits too. */
async function sendPhoto(crypto: GroupCrypto, photo: StoredPhoto): Promise<boolean> {
  const d = db();
  const upload = photo.state === "upload";
  const bytes = upload && photo.jpeg ? fromBase64(photo.jpeg) : null;
  if (upload && !bytes) {
    await d.photos.update(photo.id, { stuck: true });
    return true;
  }
  const done = started("photo", upload ? "up" : "drop");
  let res: Response;
  try {
    res = await fetch(photoUrl(photo.groupId, photo.id), {
      method: upload ? "PUT" : "DELETE",
      headers: {
        Authorization: `Bearer ${crypto.token}`,
        ...(upload ? { "Content-Type": "application/octet-stream" } : {}),
      },
      body: bytes ? new Blob([await sealPhoto(crypto, photo.groupId, photo.id, bytes) as BlobPart]) : undefined,
      signal: AbortSignal.timeout(SYNC_PATIENCE_MS),
    });
  } catch {
    done("failed");
    return false;
  }
  done(String(res.status));
  if (res.status === 410) return false;
  if (res.ok || (!upload && res.status === 404)) {
    if (upload) await d.photos.update(photo.id, { state: "held", retryAt: undefined });
    else await d.photos.delete(photo.id);
  } else if (RETRY_AFTER[res.status]) {
    await d.photos.update(photo.id, { retryAt: Date.now() + RETRY_AFTER[res.status]! });
  } else if (upload && (res.status === 413 || res.status === 400)) {
    // Refused for what it is, not for when: it stays on this phone.
    await d.photos.update(photo.id, { stuck: true });
  }
  return true;
}

/** A photo a moment ago not found isn't asked for again on every render. */
const MISS_MS = 60_000;
const fetching = new Map<string, Promise<void>>();
const missed = new Map<string, number>();

/**
 * Another phone's kept photo, fetched, opened and kept here. Single-flight per
 * photo; a 404 (not uploaded yet) waits a minute before asking again.
 */
export function fetchPhoto(groupId: string, photoId: string): Promise<void> {
  if ((missed.get(photoId) ?? 0) > Date.now()) return Promise.resolve();
  let run = fetching.get(photoId);
  if (!run) {
    run = fetchPhotoOnce(groupId, photoId)
      .catch((err: unknown) => {
        missed.set(photoId, Date.now() + MISS_MS);
        keepNote("photo", errorText(err));
      })
      .finally(() => fetching.delete(photoId));
    fetching.set(photoId, run);
  }
  return run;
}

async function fetchPhotoOnce(groupId: string, photoId: string): Promise<void> {
  const d = db();
  // The demo, or a group this phone only remembers: nothing to ask with.
  const key = await d.groupKeys.get(groupId);
  if (!key) return;
  const crypto = await groupCrypto(groupId, key.secret);
  const res = await fetch(photoUrl(groupId, photoId), {
    headers: { Authorization: `Bearer ${crypto.token}` },
    signal: AbortSignal.timeout(SYNC_PATIENCE_MS),
  });
  if (!res.ok) throw new SyncHttpError(res.status, "");
  const jpeg = await openPhoto(crypto, groupId, photoId, new Uint8Array(await res.arrayBuffer()));
  await d.transaction("rw", [d.photos, d.groupKeys], async () => {
    // Erased, or dropped here, while the request was out.
    if (!(await d.groupKeys.get(groupId)) || (await d.photos.get(photoId))) return;
    await d.photos.put({ id: photoId, groupId, jpeg: toBase64(jpeg), state: "held" });
  });
}

const healedThisSession = new Set<string>();

const applying = new Map<string, Promise<void>>();

/**
 * Groups whose stash was applied since the app last came to the front. A push
 * waits on a hidden app, so until then a screen of one of these has no news to
 * wait for, and draws from its first frame.
 */
const settled = new Set<string>();
let away = 0;

export function stashSettled(groupId: string): boolean {
  return settled.has(groupId) && !applying.has(groupId);
}

/** Hidden, a push can land a stash for any group. */
export function unsettleStashes(): void {
  away += 1;
  settled.clear();
}

export function applyStash(groupId: string): Promise<void> {
  let run = applying.get(groupId);
  if (!run) {
    const since = away;
    run = applyStashOnce(groupId)
      .catch((err: unknown) => keepNote("stash", errorText(err)))
      .finally(() => {
        applying.delete(groupId);
        if (since === away) settled.add(groupId);
      });
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

const NOTIFY_BATCH = 40;

const DEAD = new Set([404, 410]);

/**
 * Encrypted per subscription (RFC 8291), so the Worker relays ciphertext. Never
 * fails the sync.
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
 * Single-flight across the whole run: per group, a second caller would reset the
 * backoff, which against a dead server would never grow.
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
  const left = new Set((await getDevice()).leftGroups ?? []);
  // All at once: in turn, six groups took seconds to show news in the fifth.
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

/** The order `syncAll` starts groups in, newest change first; their requests then race. */
export async function byRecency<T extends { groupId: string }>(keys: T[]): Promise<T[]> {
  const ops = db().ops;
  const newest = await Promise.all(keys.map(async (key) =>
    (await ops.where("[groupId+hlc]").between([key.groupId, ""], [key.groupId, "\uffff"]).last())?.hlc ?? ""));
  return keys
    .map((key, i) => ({ key, hlc: newest[i]! }))
    .sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0))
    .map(({ key }) => key);
}

/** Every group, not every key: one with none (the demo) is settled too, or its screens wait. */
export async function applyStashes(): Promise<void> {
  const ids = await db().groups.toCollection().primaryKeys().catch(() => []);
  await Promise.all(ids.map((id) => applyStash(id)));
}

async function hasPending(groupId: string): Promise<boolean> {
  return (await db().ops.where("[groupId+pending]").equals([groupId, 1]).count()) > 0;
}

const written = new Set<string>();

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
 * Polling every group every minute cost a thousand requests a day per person;
 * only the group on screen stays a minute fresh.
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

export function startSyncLoop(): () => void {
  if (typeof window === "undefined") return () => {};

  let lastInput = Date.now();
  let lastSweep = 0;
  const sweep = () => {
    lastSweep = Date.now();
    void syncAll();
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return unsettleStashes();
    lastInput = Date.now();
    markInFlightStale();
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
