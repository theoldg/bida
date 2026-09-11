"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  atCurrentRates, computeBalances, currenciesInUse, settleUp, emptyGroupState,
  wouldViolate,
  type BalanceReport, type CurrencyInUse, type ExchangeRate, type Expense, type Group,
  type GroupState, type Member, type OpDraft, type RegisteredInvariant,
  type Settlement, type Transfer,
} from "@bida/core";
import { db, type DeviceRecord } from "./db/dexie";
import { useLive } from "./db/live";
import { getDevice } from "./db/device";
import { copy } from "./copy";
import { formatJoinLink, route } from "./group-link";

/**
 * Every screen reads through these. Two rules:
 *   - Nothing here writes. Writes go through lib/db/commands/, always.
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
 * The keyed shape every reader in core wants, out of the arrays Dexie gives —
 * **valued at the group's current rates**.
 *
 * Both hooks below need it — one for a group, one for every group at once —
 * and a balance computed from a hand-built state that forgot a field is the
 * kind of wrong nothing else catches. The repricing is here for the same
 * reason: an entry's stored `baseAmountMinor` is what it was saved at, the
 * registry says what it is worth, and one screen reading the stored figure
 * while the rest read the registry is exactly the disagreement this whole
 * thing exists to remove (ADR-0005).
 */
function stateOf(
  group: Group | undefined,
  members: Member[],
  expenses: Expense[],
  settlements: Settlement[],
  rates: ExchangeRate[] = [],
): GroupState {
  return atCurrentRates({
    ...emptyGroupState(),
    group,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    rates: Object.fromEntries(rates.map((r) => [r.id, r])),
  });
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
  const live = useLive(() => db().device.get("device"), []);
  // The record is created on first read; a live read alone would sit at
  // undefined forever on a brand-new phone.
  useEffect(() => {
    if (live === undefined) void getDevice().then(setFallback);
  }, [live]);
  return live ?? fallback;
}

/** The invite secret for a group, if this device holds it (creator or a device that joined). */
export function useGroupSecret(groupId: string | undefined): string | undefined {
  return useLive(async () => {
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
  /** The link itself, for showing when the clipboard won't take it. */
  link: string | undefined;
  /** The last attempt was refused, and the link has to be read instead. */
  failed: boolean;
  clearFailure: () => void;
} {
  const secret = useGroupSecret(groupId);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const link = groupId && secret ? formatJoinLink({ groupId, secret }) : undefined;

  const copy = useMemo(() => {
    if (!link) return undefined;
    // `writeText` rejects on an insecure context or a denied permission, and
    // it used to reject into nothing: the icon never flipped, the button read
    // as inert, and the link — the whole of this app's access model — was
    // shown nowhere else. A refusal puts it on screen to be read instead.
    return async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      } catch {
        setFailed(true);
      }
    };
  }, [link]);

  return { copy, copied, link, failed, clearFailure: () => setFailed(false) };
}

export interface GroupData {
  group: Group | undefined;
  /** Live members, sorted by name — the list every picker offers. */
  members: Member[];
  /**
   * Every member the group has ever had, removed ones included. An id on an
   * entry outlives the member it names (removal is a tombstone, never a
   * rewrite), so a map of the living answers "who is this?" with `undefined`
   * exactly when somebody has left — which is when the name matters most.
   */
  memberById: Map<string, Member>;
  /** Their name, or `copy.unknown`. Use this rather than reaching into the map. */
  nameOf: (id: string) => string;
  /** True for a member who has been removed but is still named on an entry. */
  hasLeft: (id: string) => boolean;
  /** Live expenses, newest first, valued at the group's current rates. */
  expenses: Expense[];
  /** Live transfers, newest first, valued at the group's current rates. */
  settlements: Settlement[];
  /** The group's rate registry, keyed by currency code. See `ExchangeRate`. */
  rates: Record<string, ExchangeRate>;
  /**
   * Every currency the registry has to answer for — what entries are written
   * in, plus what was added ahead of time — busiest first. What /g/rates lists.
   */
  currencies: CurrencyInUse[];
  balances: BalanceReport;
  transfers: Transfer[];
  /** The member this device is, in this group. Undefined until they pick one. */
  me: string | undefined;
  /**
   * The invariant this write would break, as far as this device can see, or
   * undefined. **The only source of a refusal in the app.** A screen that
   * decides for itself is the defect docs/invariants.md exists for: the guard
   * and its healer become two things that agree until they don't. It is a
   * courtesy either way — it reads one replica, and `healGroup` is what makes
   * the state legal when it loses.
   */
  guard: (draft: OpDraft) => RegisteredInvariant | undefined;
  pendingOps: number;
  loading: boolean;
}

const EMPTY_REPORT: BalanceReport = {
  byMember: {}, totalSpendMinor: 0, totalIncomeMinor: 0,
  paidMinor: {}, owedMinor: {}, receivedMinor: {}, incomeShareMinor: {}, settledMinor: {},
  problems: [],
};

export function useGroupData(groupId: string | undefined): GroupData {
  const rows = useLive(async () => {
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
    const rates = await d.rates.where("groupId").equals(groupId).toArray();
    return { group, members, expenses, settlements, rates, pending, device };
  }, [groupId]);

  return useMemo(() => {
    if (!rows) {
      return {
        group: undefined, members: [], memberById: new Map(),
        nameOf: () => copy.unknown, hasLeft: () => false,
        expenses: [], settlements: [], rates: {}, currencies: [],
        balances: EMPTY_REPORT, transfers: [], me: undefined,
        guard: () => undefined, pendingOps: 0, loading: true,
      };
    }
    const members = living(rows.members).sort((a, b) => a.name.localeCompare(b.name));
    const state = stateOf(
      rows.group, members,
      living(rows.expenses).sort(byWhenThenCreated),
      living(rows.settlements).sort(byWhenThenCreated),
      living(rows.rates),
    );
    // Back out of the repriced state, in the order they went in — `stateOf`
    // keys them and loses the sort. Every screen reads these two arrays, so
    // none of them can be left looking at a stale conversion.
    const bySortOrder = <T extends { id: string }>(rows: T[], keyed: Record<string, T>) =>
      rows.map((row) => keyed[row.id] ?? row);
    const expenses = bySortOrder(living(rows.expenses).sort(byWhenThenCreated), state.expenses);
    const settlements = bySortOrder(
      living(rows.settlements).sort(byWhenThenCreated), state.settlements);

    const balances = computeBalances(state);
    const memberById = new Map((rows.members ?? []).map((m) => [m.id, m]));
    // Detection needs the tombstones, which `state` has filtered out — a
    // removed member on a live entry is the whole point. Folded from the raw
    // rows and handed to the registry, never re-derived here: a screen that
    // decides for itself what is broken is the drift docs/invariants.md is
    // about.
    const withTombstones: GroupState = {
      ...emptyGroupState(),
      group: rows.group,
      members: Object.fromEntries((rows.members ?? []).map((m) => [m.id, m])),
      expenses: Object.fromEntries((rows.expenses ?? []).map((e) => [e.id, e])),
      settlements: Object.fromEntries((rows.settlements ?? []).map((s) => [s.id, s])),
      rates: Object.fromEntries((rows.rates ?? []).map((r) => [r.id, r])),
    };
    return {
      group: rows.group,
      members,
      memberById,
      nameOf: (id) => memberById.get(id)?.name ?? copy.unknown,
      hasLeft: (id) => !!memberById.get(id)?.deletedAt,
      expenses,
      settlements,
      rates: state.rates,
      currencies: currenciesInUse(state),
      balances,
      transfers: settleUp(balances.byMember),
      me: groupId ? rows.device?.meByGroup[groupId] : undefined,
      guard: (draft) => wouldViolate(withTombstones, draft),
      pendingOps: rows.pending,
      loading: false,
    };
  }, [rows, groupId]);
}

/**
 * Send a phone that has not said who it is to the screen that asks.
 *
 * A device with no claimed member has no honest `actor` to sign an op with,
 * and every screen under `/g` writes one: the fallbacks that filled the gap
 * signed with whoever the action was *about*, so removing Bruno from an
 * unclaimed phone went into history as "Bruno left the group". There is no
 * leaving — only being removed — so that line could only ever be a lie.
 *
 * `/g` has redirected since the trash button showed up next to every name on
 * an unclaimed phone; the rest of the group's screens are reachable on their
 * own (a bookmark, an invite link's back arrow, a settle-up row), so they
 * redirect too. `/g/claim` is the exception, being the destination.
 *
 * Returns whether we are on our way out, so the caller can draw a frame
 * instead of somebody else's ledger while the replace lands.
 */
export function useClaimGate(groupId: string | undefined, data: GroupData): boolean {
  const router = useRouter();
  const unclaimed = !data.loading && !!data.group && !data.me;
  useEffect(() => {
    if (groupId && unclaimed) router.replace(route.claim(groupId));
  }, [groupId, unclaimed, router]);
  return unclaimed;
}

export interface GroupSummary {
  group: Group;
  memberCount: number;
  entryCount: number;
  /** This device's net position, or undefined if they haven't said who they are. */
  netMinor: number | undefined;
  lastActivity: number;
  /** The member this device is, in this group — same undefined-until-claimed as `GroupData.me`. */
  me: string | undefined;
}

/** The groups list, with each group's net for whoever is holding the phone. */
export function useGroupSummaries(): GroupSummary[] | undefined {
  return useLive(async () => {
    const d = db();
    // Five reads, not three per group. Every row on this phone belongs to a
    // group in this list, so fetching each table whole and bucketing it here
    // moves the same bytes in a constant number of IndexedDB round trips —
    // the group list was the one screen whose cost grew with the group count.
    const [groups, device, members, expenses, settlements, rates] = await Promise.all([
      d.groups.toArray(),
      d.device.get("device"),
      d.members.toArray(),
      d.expenses.toArray(),
      d.settlements.toArray(),
      d.rates.toArray(),
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
    const r = byGroup(rates);

    const left = new Set(device?.leftGroups ?? []);
    const out: GroupSummary[] = [];
    for (const group of groups) {
      // Left means gone from this phone, whether or not the group itself
      // still has other people in it — this list is "your groups", not
      // "every group this device has ever synced".
      if (left.has(group.id)) continue;
      const live = {
        m: m.get(group.id) ?? [], e: e.get(group.id) ?? [], s: s.get(group.id) ?? [],
        r: r.get(group.id) ?? [],
      };
      const balances = computeBalances(stateOf(group, live.m, live.e, live.s, live.r));
      const me = device?.meByGroup[group.id];
      out.push({
        group,
        memberCount: live.m.length,
        entryCount: live.e.length + live.s.length,
        netMinor: me ? balances.byMember[me] ?? 0 : undefined,
        me,
        lastActivity: Math.max(
          group.createdAt,
          ...live.e.map((x) => x.occurredAt),
          ...live.s.map((x) => x.occurredAt),
        ),
      });
    }
    return out.sort((a, b) => b.lastActivity - a.lastActivity);
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
  const key = useLive(async () => {
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
