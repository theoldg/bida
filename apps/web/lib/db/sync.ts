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
    throw new Error(`sync push failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as PushPullResponse;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
}

/**
 * Push this device's unsynced ops for one group and pull whatever the server
 * has that this device hasn't seen. A no-op (returns `undefined`) if this
 * device doesn't hold that group's secret.
 */
export async function syncGroup(groupId: string): Promise<SyncOutcome | undefined> {
  const d = db();
  const key = await d.groupKeys.get(groupId);
  if (!key) return undefined;

  const pending = await d.ops.where("groupId").equals(groupId).and((op) => op.pending === 1).toArray();
  const { assigned, ops: pulled, latestSeq } = await pushPullGroup(groupId, key.secret, key.lastSeq, pending);

  await d.transaction("rw", [d.ops, d.groupKeys], async () => {
    for (const op of pending) {
      const seq = assigned[op.id];
      if (seq !== undefined) await d.ops.update(op.id, { seq, pending: 0 });
    }
    if (pulled.length > 0) {
      await d.ops.bulkPut(pulled.map((op): StoredOp => ({ ...op, pending: 0 })));
    }
    const current = await d.groupKeys.get(groupId);
    await d.groupKeys.put({ groupId, secret: key.secret, lastSeq: Math.max(latestSeq, current?.lastSeq ?? 0) });
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
