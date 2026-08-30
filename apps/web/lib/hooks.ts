"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import {
  computeBalances, settleUp, emptyGroupState,
  type BalanceReport, type Expense, type Group, type GroupState, type Member,
  type Settlement, type Transfer,
} from "@hajsik/core";
import { db, type DeviceRecord } from "./db/dexie";
import { getDevice } from "./db/device";
import { formatJoinLink } from "./group-link";

/**
 * Every screen reads through these. Two rules:
 *   - Nothing here writes. Writes go through lib/db/commands.ts, always.
 *   - Derived money (balances, settle-up) is computed here from the
 *     materialised rows, never stored. It is cheap and it cannot go stale.
 */

/**
 * The rows that haven't been tombstoned. Core exports an `alive` of its own
 * over the keyed records in a `GroupState`; this is the same rule over what
 * Dexie hands back, which is arrays.
 */
function living<T extends { deletedAt?: number | null }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => !r.deletedAt);
}

/**
 * The keyed shape every reader in core wants, out of the arrays Dexie gives.
 * Both hooks below need it — one for a group, one for every group at once —
 * and a balance computed from a hand-built state that forgot a field is the
 * kind of wrong nothing else catches.
 */
function stateOf(
  group: Group | undefined,
  members: Member[],
  expenses: Expense[],
  settlements: Settlement[],
): GroupState {
  return {
    ...emptyGroupState(),
    group,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
  };
}

/**
 * Newest first by the user-facing date, then by actual entry order — two
 * expenses backdated to the same day, or added within the same minute, still
 * need a stable, deterministic order rather than whatever IndexedDB handed
 * back. `createdAt` is absent on expenses written before it existed, so those
 * fall back to `occurredAt` for the tiebreak (a wash, but never crashes).
 */
function byWhenThenCreated(a: Expense | Settlement, b: Expense | Settlement): number {
  return (b.occurredAt - a.occurredAt) || ((b.createdAt ?? b.occurredAt) - (a.createdAt ?? a.occurredAt));
}

export function useDevice(): DeviceRecord | undefined {
  const [fallback, setFallback] = useState<DeviceRecord>();
  const live = useLiveQuery(() => db().device.get("device"), []);
  // The record is created on first read; useLiveQuery alone would sit at
  // undefined forever on a brand-new phone.
  useEffect(() => {
    if (live === undefined) void getDevice().then(setFallback);
  }, [live]);
  return live ?? fallback;
}

/** The invite secret for a group, if this device holds it (creator or a device that joined). */
export function useGroupSecret(groupId: string | undefined): string | undefined {
  return useLiveQuery(async () => {
    if (!groupId) return undefined;
    return (await db().groupKeys.get(groupId))?.secret;
  }, [groupId]);
}

/**
 * The invite link for a group, and a one-tap copy of it.
 *
 * Copying, not `navigator.share`: the share sheet is a modal detour with a
 * different set of destinations on every phone, and the answer was always
 * "put it on the clipboard". `copied` flips back on its own so the button can
 * say so without a dialog to dismiss.
 */
export function useInviteLink(groupId: string | undefined): {
  copy: (() => Promise<void>) | undefined;
  copied: boolean;
} {
  const secret = useGroupSecret(groupId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useMemo(() => {
    if (!groupId || !secret) return undefined;
    return async () => {
      await navigator.clipboard.writeText(formatJoinLink({ groupId, secret }));
      setCopied(true);
    };
  }, [groupId, secret]);

  return { copy, copied };
}

export interface GroupData {
  group: Group | undefined;
  members: Member[];
  memberById: Map<string, Member>;
  expenses: Expense[];
  settlements: Settlement[];
  balances: BalanceReport;
  transfers: Transfer[];
  /** The member this device is, in this group. Undefined until they pick one. */
  me: string | undefined;
  pendingOps: number;
  loading: boolean;
}

const EMPTY_REPORT: BalanceReport = {
  byMember: {}, totalSpendMinor: 0, totalIncomeMinor: 0,
  paidMinor: {}, owedMinor: {}, receivedMinor: {}, incomeShareMinor: {}, problems: [],
};

export function useGroupData(groupId: string | undefined): GroupData {
  const rows = useLiveQuery(async () => {
    if (!groupId) return undefined;
    const d = db();
    const [group, members, expenses, settlements, pending, device] = await Promise.all([
      d.groups.get(groupId),
      d.members.where("groupId").equals(groupId).toArray(),
      d.expenses.where("groupId").equals(groupId).toArray(),
      d.settlements.where("groupId").equals(groupId).toArray(),
      d.ops.where("[groupId+hlc]").between([groupId, ""], [groupId, "￿"]).filter((o) => o.pending === 1).count(),
      d.device.get("device"),
    ]);
    return { group, members, expenses, settlements, pending, device };
  }, [groupId]);

  return useMemo(() => {
    if (!rows) {
      return {
        group: undefined, members: [], memberById: new Map(), expenses: [], settlements: [],
        balances: EMPTY_REPORT, transfers: [], me: undefined, pendingOps: 0, loading: true,
      };
    }
    const members = living(rows.members).sort((a, b) => a.name.localeCompare(b.name));
    const expenses = living(rows.expenses).sort(byWhenThenCreated);
    const settlements = living(rows.settlements).sort(byWhenThenCreated);

    const balances = computeBalances(stateOf(rows.group, members, expenses, settlements));
    return {
      group: rows.group,
      members,
      memberById: new Map(members.map((m) => [m.id, m])),
      expenses,
      settlements,
      balances,
      transfers: settleUp(balances.byMember),
      me: groupId ? rows.device?.meByGroup[groupId] : undefined,
      pendingOps: rows.pending,
      loading: false,
    };
  }, [rows, groupId]);
}

export interface GroupSummary {
  group: Group;
  memberCount: number;
  entryCount: number;
  /** This device's net position, or undefined if they haven't said who they are. */
  netMinor: number | undefined;
  lastActivity: number;
}

/** The groups list, with each group's net for whoever is holding the phone. */
export function useGroupSummaries(): GroupSummary[] | undefined {
  return useLiveQuery(async () => {
    const d = db();
    // Five reads, not three per group. Every row on this phone belongs to a
    // group in this list, so fetching each table whole and bucketing it here
    // moves the same bytes in a constant number of IndexedDB round trips —
    // the group list was the one screen whose cost grew with the group count.
    const [groups, device, members, expenses, settlements] = await Promise.all([
      d.groups.toArray(),
      d.device.get("device"),
      d.members.toArray(),
      d.expenses.toArray(),
      d.settlements.toArray(),
    ]);
    const byGroup = <T extends { groupId: string; deletedAt?: number | null }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        if (row.deletedAt) continue;
        const bucket = map.get(row.groupId);
        if (bucket) bucket.push(row); else map.set(row.groupId, [row]);
      }
      return map;
    };
    const m = byGroup(members), e = byGroup(expenses), s = byGroup(settlements);

    const left = new Set(device?.leftGroups ?? []);
    const out: GroupSummary[] = [];
    for (const group of groups) {
      // Left means gone from this phone, whether or not the group itself
      // still has other people in it — this list is "your groups", not
      // "every group this device has ever synced".
      if (left.has(group.id)) continue;
      const live = {
        m: m.get(group.id) ?? [], e: e.get(group.id) ?? [], s: s.get(group.id) ?? [],
      };
      const balances = computeBalances(stateOf(group, live.m, live.e, live.s));
      const me = device?.meByGroup[group.id];
      out.push({
        group,
        memberCount: live.m.length,
        entryCount: live.e.length + live.s.length,
        netMinor: me ? balances.byMember[me] ?? 0 : undefined,
        lastActivity: Math.max(
          group.createdAt,
          ...live.e.map((x) => x.occurredAt),
          ...live.s.map((x) => x.occurredAt),
        ),
      });
    }
    return out.sort((a, b) => Number(!!a.group.archivedAt) - Number(!!b.group.archivedAt)
      || b.lastActivity - a.lastActivity);
  }, []);
}

/**
 * How sync is actually going for one group.
 *
 * `navigator.onLine` answers a different question — whether there is a link,
 * not whether the other end is answering. A Worker that 500s, a D1 outage or a
 * key the server rejects all leave the phone "online" while nothing it writes
 * ever leaves it, which is the one failure that quietly costs a trip its
 * ledger. So the sync engine writes down how each attempt went and this reads
 * it back.
 */
export interface SyncHealth {
  /** Failing for long enough to be worth saying out loud — see FAILURES_BEFORE_WARNING. */
  failing: boolean;
  /** The server refused this device's secret. Retrying cannot fix it; a fresh link can. */
  rejected: boolean;
  /** When this device last completed a sync of this group, if it ever has. */
  lastSyncedAt: number | undefined;
}

/**
 * One failed attempt is a dropped packet on a train. Two, spaced by the
 * engine's own backoff, is a server that isn't there — and only then does a
 * banner earn its place.
 */
const FAILURES_BEFORE_WARNING = 2;

export function useSyncHealth(groupId: string | undefined): SyncHealth {
  const key = useLiveQuery(async () => {
    if (!groupId) return undefined;
    return (await db().groupKeys.get(groupId)) ?? null;
  }, [groupId]);

  return useMemo(() => {
    const failure = key?.failure;
    const rejected = failure?.status === 403;
    return {
      failing: rejected || (failure?.count ?? 0) >= FAILURES_BEFORE_WARNING,
      rejected,
      lastSyncedAt: key?.lastSyncedAt,
    };
  }, [key]);
}

/** Whether the browser thinks it is online. Drives the offline banner. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);
  return online;
}
