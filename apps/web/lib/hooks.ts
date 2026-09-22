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
import { writeClipboardText } from "./clipboard";
import { copy } from "./copy";
import { byWhen } from "./format";
import { tick } from "./haptics";
import { formatJoinLink, route } from "./group-link";

/**
 * Every screen reads through these. Two rules:
 *   - Nothing here writes. Writes go through lib/db/commands/, always.
 *   - Derived money (balances, settle-up) is computed here from the
 *     materialised rows, never stored. It is cheap and it cannot go stale.
 */

/**
 * The rows that haven't been tombstoned — core's `alive`, over Dexie's arrays.
 */
function living<T extends { deletedAt?: number | null }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => !r.deletedAt);
}

/**
 * The keyed shape core's readers want, from Dexie's arrays — **valued at the
 * group's current rates**. One builder, because a hand-built state missing a
 * field is wrong in a way nothing catches, and one screen reading the stored
 * `baseAmountMinor` while the rest read the registry is the disagreement
 * ADR-0005 removes.
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

export function useDevice(): DeviceRecord | undefined {
  const [fallback, setFallback] = useState<DeviceRecord>();
  const live = useLive("device", () => db().device.get("device"), []);
  // The record is created on first read; a live read alone would sit at
  // undefined forever on a brand-new phone.
  useEffect(() => {
    if (live === undefined) void getDevice().then(setFallback);
  }, [live]);
  return live ?? fallback;
}

/**
 * Whether this phone is reading scanned bills in English. False until Dexie
 * answers, which is also the default, so a bill is never drawn in a language
 * it then leaves (`DeviceRecord.billEnglish`).
 */
export function useBillEnglish(): boolean {
  return useDevice()?.billEnglish ?? false;
}

/**
 * The invite secret for a group, if this device holds it.
 *
 * `null`, not `undefined`, for no key row: to `useLive` `undefined` is a read
 * that hasn't answered, so the demo group (core/demo.ts) or a dropped key
 * would show "Still reading this phone's data…" over a drawn ledger.
 */
export function useGroupSecret(groupId: string | undefined): string | undefined {
  return useLive("groupSecret", async () => {
    if (!groupId) return null;
    return (await db().groupKeys.get(groupId))?.secret ?? null;
  }, [groupId]) ?? undefined;
}

/**
 * The invite link for a group, and a one-tap copy of it. Clipboard, not
 * `navigator.share` — the share sheet is a different detour on every phone.
 * `copied` flips back on its own, so no dialog to dismiss.
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
    // A write fails on an insecure context, a denied permission or no clipboard
    // (lib/clipboard.ts). Never swallow it: the link is the whole access model,
    // so a refusal puts it on screen to be read instead.
    return async () => {
      try {
        await writeClipboardText(link);
        setCopied(true);
        // The check that says so is a small glyph in a top bar, and on the
        // groups list it is in a menu that has already closed (lib/haptics.ts).
        tick();
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
   * Every member the group has ever had, removed ones included: an entry's id
   * outlives the member (removal is a tombstone), and the name matters most
   * exactly when they've left.
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
   * undefined. **The only source of a refusal in the app** — a screen deciding
   * for itself is the drift docs/invariants.md is about. A courtesy either way:
   * `healGroup` is what makes the state legal when it loses.
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
  const rows = useLive("groupData", async () => {
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
      living(rows.expenses).sort(byWhen),
      living(rows.settlements).sort(byWhen),
      living(rows.rates),
    );
    // Back out of the repriced state, in the order they went in — `stateOf`
    // keys them and loses the sort. Every screen reads these two arrays, so
    // none of them can be left looking at a stale conversion.
    const bySortOrder = <T extends { id: string }>(rows: T[], keyed: Record<string, T>) =>
      rows.map((row) => keyed[row.id] ?? row);
    const expenses = bySortOrder(living(rows.expenses).sort(byWhen), state.expenses);
    const settlements = bySortOrder(
      living(rows.settlements).sort(byWhen), state.settlements);

    const balances = computeBalances(state);
    const memberById = new Map((rows.members ?? []).map((m) => [m.id, m]));
    // Detection needs the tombstones `state` filtered out — a removed member on a
    // live entry is the point. Folded from raw rows and handed to the registry,
    // never re-derived here.
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
 * Send a phone that hasn't said who it is to the screen that asks.
 *
 * A device with no claimed member has no honest `actor` for an op. **Never
 * fall back to the member an action is *about***: removing Bruno would read
 * "Bruno left the group", and there is no leaving.
 *
 * Every `/g` screen redirects (each is reachable on its own) except
 * `/g/claim`. Returns whether we are leaving, so the caller draws a frame
 * rather than somebody else's ledger.
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

/**
 * How many groups this phone holds a key to but has never seen — waiting on a
 * first sync. A home-screen icon arrives carrying its invites (docs/ios.md),
 * and without this its first launch shows the empty state.
 *
 * **Count keys against groups, minus `leftGroups`** — forgetting a group keeps
 * its key, so keys alone would wait forever.
 */
export function useArrivingGroups(): number | undefined {
  return useLive("arrivingGroups", async () => {
    const d = db();
    const [keys, device, groups] = await Promise.all([
      d.groupKeys.toArray(),
      d.device.get("device"),
      d.groups.toArray(),
    ]);
    const left = new Set(device?.leftGroups ?? []);
    const arrived = new Set(groups.map((g) => g.id));
    return keys.filter((k) => !left.has(k.groupId) && !arrived.has(k.groupId)).length;
  }, []);
}

/** The groups list, with each group's net for whoever is holding the phone. */
export function useGroupSummaries(): GroupSummary[] | undefined {
  return useLive("groupSummaries", async () => {
    const d = db();
    // Five reads, not three per group: fetching each table whole and bucketing
    // here is a constant number of IndexedDB round trips.
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
 * How sync is actually going for one group. **Never `navigator.onLine`** — it
 * says there is a link, not that the server answers; a 500, a D1 outage or a
 * rejected key all look "online". This reads what the engine recorded.
 */
interface SyncHealth {
  /** Failing for long enough to be worth saying out loud — see FAILURES_BEFORE_WARNING. */
  failing: boolean;
  /** The server refused this device's secret. Retrying cannot fix it; a fresh link can. */
  rejected: boolean;
  /** When this device last completed a sync of this group, if it ever has. */
  lastSyncedAt: number | undefined;
}

/**
 * One failure is a dropped packet on a train; two, spaced by the engine's
 * backoff, is a server that isn't there — only then a banner.
 */
const FAILURES_BEFORE_WARNING = 2;

export function useSyncHealth(groupId: string | undefined): SyncHealth {
  const key = useLive("syncHealth", async () => {
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

/**
 * The host this copy was opened from — `""` until the bundle lands. Only the
 * browser knows it (dev and self-hosted Workers differ,
 * [hosting.md](../../../docs/hosting.md)), so it can't be baked into the
 * export; before hydration a sentence shows the bare path.
 */
export function useHost(): string {
  const [host, setHost] = useState("");
  useEffect(() => setHost(location.host), []);
  return host;
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
