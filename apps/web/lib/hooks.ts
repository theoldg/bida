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

function alive<T extends { deletedAt?: number | null }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => !r.deletedAt);
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

/** Personal mode, on by default — see DEFAULTS in lib/db/device.ts. */
export function usePersonalMode(): boolean {
  return useDevice()?.personalMode ?? true;
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
  byMember: {}, totalSpendMinor: 0, paidMinor: {}, owedMinor: {}, problems: [],
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
    const members = alive(rows.members).sort((a, b) => a.name.localeCompare(b.name));
    const expenses = alive(rows.expenses).sort((a, b) => b.occurredAt - a.occurredAt);
    const settlements = alive(rows.settlements).sort((a, b) => b.occurredAt - a.occurredAt);

    const state: GroupState = {
      ...emptyGroupState(),
      group: rows.group,
      members: Object.fromEntries(members.map((m) => [m.id, m])),
      expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
      settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    };
    const balances = computeBalances(state);
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
  expenseCount: number;
  /** This device's net position, or undefined if they haven't said who they are. */
  netMinor: number | undefined;
  lastActivity: number;
}

/** The groups list, with each group's net for whoever is holding the phone. */
export function useGroupSummaries(): GroupSummary[] | undefined {
  return useLiveQuery(async () => {
    const d = db();
    const [groups, device] = await Promise.all([d.groups.toArray(), d.device.get("device")]);
    const out: GroupSummary[] = [];
    for (const group of groups) {
      const [members, expenses, settlements] = await Promise.all([
        d.members.where("groupId").equals(group.id).toArray(),
        d.expenses.where("groupId").equals(group.id).toArray(),
        d.settlements.where("groupId").equals(group.id).toArray(),
      ]);
      const live = { m: alive(members), e: alive(expenses), s: alive(settlements) };
      const balances = computeBalances({
        ...emptyGroupState(),
        group,
        members: Object.fromEntries(live.m.map((m) => [m.id, m])),
        expenses: Object.fromEntries(live.e.map((e) => [e.id, e])),
        settlements: Object.fromEntries(live.s.map((s) => [s.id, s])),
      });
      const me = device?.meByGroup[group.id];
      out.push({
        group,
        memberCount: live.m.length,
        expenseCount: live.e.length,
        netMinor: me ? balances.byMember[me] ?? 0 : undefined,
        lastActivity: Math.max(
          group.createdAt,
          ...live.e.map((e) => e.occurredAt),
          ...live.s.map((s) => s.occurredAt),
        ),
      });
    }
    return out.sort((a, b) => Number(!!a.group.archivedAt) - Number(!!b.group.archivedAt)
      || b.lastActivity - a.lastActivity);
  }, []);
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
