import type { Op } from "@hajsik/core";
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

/**
 * Push this device's unsynced ops for one group and pull whatever the server
 * has that this device hasn't seen. A no-op (returns `undefined`) if this
 * device doesn't hold that group's secret.
 *
 * Rejects on failure, having recorded it on the group's key first — callers
 * are free to ignore the rejection, and the UI reads the record instead.
 */
export async function syncGroup(groupId: string): Promise<SyncOutcome | undefined> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return undefined;

  const pending = await d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).toArray();
  let response: PushPullResponse;
  try {
    response = await pushPullGroup(groupId, key.secret, key.lastSeq, pending);
  } catch (err) {
    await recordFailure(groupId, err);
    throw err;
  }
  const { assigned, ops: pulled, latestSeq } = response;

  await d.transaction("rw", [d.ops, d.groupKeys], async () => {
    for (const op of pending) {
      const seq = assigned[op.id];
      if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
    }
    if (pulled.length > 0) {
      await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
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
  if (pulled.length > 0) await rebuild(groupId);

  return { pushed: pending.length, pulled: pulled.length };
}

let syncing = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
let backoffMs = 2000;
const BACKOFF_MAX_MS = 60000;

/** Runs every group's sync once, sequentially, skipping any already in flight. */
export async function syncAll(): Promise<void> {
  const keys = await db().groupKeys.toArray();
  let anyFailure = false;
  for (const key of keys) {
    if (syncing.has(key.groupId)) continue;
    syncing.add(key.groupId);
    try {
      await syncGroup(key.groupId);
    } catch {
      anyFailure = true;
    } finally {
      syncing.delete(key.groupId);
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
