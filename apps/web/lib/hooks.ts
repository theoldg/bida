"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Dexie from "dexie";
import {
  CATCH_UP_MS, atCurrentRates, computeBalances, currenciesInUse, settleUp, emptyGroupState,
  parseHlc, stateFromRows, unseenRevisions, wouldViolate,
  type BalanceReport, type CurrencyInUse, type ExchangeRate, type Expense, type Group,
  type GroupState, type Member, type OpDraft, type RegisteredInvariant,
  type Settlement, type Transfer,
} from "@bida/core";
import { db, type DeviceRecord } from "./db/dexie";
import { keepWarm, useLive } from "./db/live";
import { opsForGroup } from "./db/fold";
import { getDevice, getMe } from "./db/device";
import { applyStash, stashSettled } from "./db/sync";
import { writeClipboardText } from "./clipboard";
import { copy } from "./copy";
import { sortedByWhen } from "./format";
import { tick } from "./haptics";
import { formatJoinLink, route } from "./group-link";

/**
 * Every screen reads through these. Nothing here writes, and derived money is
 * computed here from the rows, never stored.
 */

function living<T extends { deletedAt?: number | null }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((r) => !r.deletedAt);
}

export function useDevice(): DeviceRecord | undefined {
  const [fallback, setFallback] = useState<DeviceRecord>();
  const live = useLive("device", () => db().device.get("device"), []);
  // The record is created on first read; a live read alone would sit at undefined
  // forever on a brand-new phone.
  useEffect(() => {
    if (live === undefined) void getDevice().then(setFallback);
  }, [live]);
  return live ?? fallback;
}

/**
 * `null`, not `undefined`, for no key row: to `useLive` `undefined` is a read
 * that hasn't answered.
 */
export function useGroupSecret(groupId: string | undefined): string | undefined {
  return useLive("groupSecret", async () => {
    if (!groupId) return null;
    return (await db().groupKeys.get(groupId))?.secret ?? null;
  }, [groupId]) ?? undefined;
}

export function useFlash(ms = 1600): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return [on, setOn];
}

/**
 * Clipboard, not `navigator.share`: the share sheet is a different detour on
 * every phone.
 */
export function useInviteLink(groupId: string | undefined): {
  copy: (() => Promise<void>) | undefined;
  copied: boolean;
  link: string | undefined;
  failed: boolean;
  clearFailure: () => void;
} {
  const secret = useGroupSecret(groupId);
  const [copied, setCopied] = useFlash();
  const [failed, setFailed] = useState(false);

  const link = groupId && secret ? formatJoinLink({ groupId, secret }) : undefined;

  const copy = useMemo(() => {
    if (!link) return undefined;
    // Never swallow a refusal: the link is the whole access model, so it goes on
    // screen to be read instead.
    return async () => {
      try {
        await writeClipboardText(link);
        setCopied(true);
        // The check is a small glyph, or in a menu that has already closed.
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
  members: Member[];
  /** Removed ones included: the name matters most exactly when they've left. */
  memberById: Map<string, Member>;
  nameOf: (id: string) => string;
  hasLeft: (id: string) => boolean;
  expenses: Expense[];
  settlements: Settlement[];
  /** The old rate registry: a fallback for `latestRate`. */
  rates: Record<string, ExchangeRate>;
  currencies: CurrencyInUse[];
  balances: BalanceReport;
  transfers: Transfer[];
  me: string | undefined;
  /**
   * **The only source of a refusal in the app** — a screen deciding for itself is
   * the drift docs/invariants.md is about. `healGroup` makes the state legal when
   * it loses.
   */
  guard: (draft: OpDraft) => RegisteredInvariant | undefined;
  /** For the deleted entry's screen; everything else reads the live arrays. */
  withTombstones: GroupState;
  /** Every entry, deleted ones included — history's, whose subject may be gone. */
  expenseById: Map<string, Expense>;
  settlementById: Map<string, Settlement>;
  pendingOps: number;
  loading: boolean;
}

const EMPTY_REPORT: BalanceReport = {
  byMember: {}, totalSpendMinor: 0, totalIncomeMinor: 0,
  paidMinor: {}, owedMinor: {}, receivedMinor: {}, incomeShareMinor: {}, settledMinor: {},
  problems: [],
};

/**
 * Held as loading until then, so a group opened from a notification draws with
 * the news already in it. Only the first screen since the app came to the
 * front waits; the rest would only flash a skeleton.
 */
function useStashApplied(groupId: string | undefined): boolean {
  const settled = !groupId || stashSettled(groupId);
  // Kept once drawn: going away unsettles every group, the one on screen too.
  const [applied, setApplied] = useState(() => settled ? groupId : undefined);
  useEffect(() => {
    if (!groupId) return;
    if (settled) return setApplied(groupId);
    let live = true;
    void applyStash(groupId).then(() => { if (live) setApplied(groupId); });
    return () => { live = false; };
  }, [groupId, settled]);
  return settled || applied === groupId;
}

/** One read for every screen of a group, so the first one opened readies the rest. */
function groupRows(groupId: string | undefined) {
  return async () => {
    if (!groupId) return undefined;
    const d = db();
    // Not the device row: every save and every pull writes it, and each would
    // read every group kept warm again. Who you are comes from `useDevice`.
    const [group, members, expenses, settlements, pending, rates] = await Promise.all([
      d.groups.get(groupId),
      d.members.where("groupId").equals(groupId).toArray(),
      d.expenses.where("groupId").equals(groupId).toArray(),
      d.settlements.where("groupId").equals(groupId).toArray(),
      // By the index alone: an import leaves thousands waiting.
      d.ops.where("[groupId+pending]").equals([groupId, 1]).count(),
      d.rates.where("groupId").equals(groupId).toArray(),
    ]);
    return { group, members, expenses, settlements, rates, pending };
  };
}

type GroupRows = NonNullable<Awaited<ReturnType<ReturnType<typeof groupRows>>>>;
type Derived = Omit<GroupData, "me" | "loading">;

/**
 * By the rows read, not per screen: every screen of a group is handed the same
 * answer (lib/db/live.ts keeps it the same object), so the balances are worked
 * out once rather than again on every screen opened.
 */
const derived = new WeakMap<GroupRows, Derived>();

function derive(rows: GroupRows): Derived {
  const known = derived.get(rows);
  if (known) return known;
  const members = living(rows.members).sort((a, b) => a.name.localeCompare(b.name));
  const sortedExpenses = sortedByWhen(living(rows.expenses));
  const sortedSettlements = sortedByWhen(living(rows.settlements));
  // Detection needs the tombstones: a removed member on a live entry is the
  // point.
  const withTombstones = stateFromRows(rows);
  // Each entry valued at the rate it is read at, here and nowhere else: one
  // screen reading the stored `baseAmountMinor` is how screens disagree
  // (ADR-0005). Tombstones and all, as balances and currencies read the living
  // alone: a second state cost a 10,000-entry group a tenth of a second.
  const state = atCurrentRates({
    ...withTombstones, rates: Object.fromEntries(living(rows.rates).map((r) => [r.id, r])),
  });
  // The state keys them and loses the sort.
  const bySortOrder = <T extends { id: string }>(rows: T[], keyed: Record<string, T>) =>
    rows.map((row) => keyed[row.id] ?? row);
  const balances = computeBalances(state);
  const memberById = new Map((rows.members ?? []).map((m) => [m.id, m]));
  const out: Derived = {
    group: rows.group,
    members,
    memberById,
    nameOf: (id) => memberById.get(id)?.name ?? copy.unknown,
    hasLeft: (id) => !!memberById.get(id)?.deletedAt,
    expenses: bySortOrder(sortedExpenses, state.expenses),
    settlements: bySortOrder(sortedSettlements, state.settlements),
    rates: state.rates,
    currencies: currenciesInUse(state),
    balances,
    transfers: settleUp(balances.byMember),
    guard: (draft) => wouldViolate(withTombstones, draft),
    withTombstones,
    expenseById: new Map(Object.entries(withTombstones.expenses)),
    settlementById: new Map(Object.entries(withTombstones.settlements)),
    pendingOps: rows.pending,
  };
  derived.set(rows, out);
  return out;
}

/**
 * History's one read of its own: every op, kept apart from `groupRows` so a
 * screen that never opens history doesn't read the log. Its members and entries,
 * deleted ones included, are the group's read (`memberById`, `expenseById`).
 */
export function historyOps(groupId: string | undefined) {
  return async () => (groupId ? opsForGroup(groupId) : []);
}

/** Readies a group's screens before one is opened (lib/db/live.ts). */
export function warmGroup(groupId: string): void {
  keepWarm("groupData", groupRows(groupId), [groupId]);
}

/**
 * History's read, started by the finger landing on its button. Not kept warm
 * from the ledger: a warm log is read again whole on every save, a quarter of
 * a 10,000-entry save's time, for a screen most visits never open.
 */
export function warmHistory(groupId: string): void {
  keepWarm("historyOps", historyOps(groupId), [groupId], { now: true });
}

export function useGroupData(groupId: string | undefined): GroupData {
  const stashed = useStashApplied(groupId);
  const rows = useLive("groupData", groupRows(groupId), [groupId]);

  const device = useDevice();
  const me = groupId ? device?.meByGroup[groupId] : undefined;
  const answered = device !== undefined;

  return useMemo(() => {
    if (!rows || !stashed || !answered) {
      return {
        group: undefined, members: [], memberById: new Map(),
        nameOf: () => copy.unknown, hasLeft: () => false,
        expenses: [], settlements: [], rates: {}, currencies: [],
        balances: EMPTY_REPORT, transfers: [], me: undefined,
        guard: () => undefined, withTombstones: emptyGroupState(), pendingOps: 0, loading: true,
        expenseById: new Map(), settlementById: new Map(),
      };
    }
    return { ...derive(rows), me, loading: false };
  }, [rows, stashed, answered, me]);
}

/**
 * A device with no claimed member has no honest `actor`. **Never fall back to the
 * member an action is about**: removing Bruno would read "Bruno left".
 *
 * Asks the device again before leaving: `data` can be the read's last answer from
 * before the claim landed, bouncing the Continue that just answered it.
 */
export function useClaimGate(groupId: string | undefined, data: GroupData): boolean {
  const router = useRouter();
  const unclaimed = !data.loading && !!data.group && !data.me;
  useEffect(() => {
    if (!groupId || !unclaimed) return;
    let current = true;
    void getMe(groupId).then((me) => {
      if (current && !me) router.replace(route.claim(groupId));
    });
    return () => { current = false; };
  }, [groupId, unclaimed, router]);
  return unclaimed;
}

/** What the list itself reads; each row's figures are its group's own read (`useGroupFigures`). */
export interface GroupSummary {
  group: Group;
  lastActivity: number;
  me: string | undefined;
  newCount: number;
}

export interface GroupFigures {
  memberCount: number;
  entryCount: number;
  netMinor: number | undefined;
}

/**
 * A row's figures, from the very read the group's screens make: a save wakes
 * that group's read alone, Dexie answers it once for the ledger and the list
 * row together, and `derive` works it out once per answer for both — where a
 * list read of every table re-read and re-added every group on any change.
 */
export function useGroupFigures(groupId: string, me: string | undefined): GroupFigures | undefined {
  const rows = useLive("groupData", groupRows(groupId), [groupId]);
  return useMemo(() => {
    if (!rows) return undefined;
    const { members, expenses, settlements, balances } = derive(rows);
    return {
      memberCount: members.length,
      entryCount: expenses.length + settlements.length,
      netMinor: me ? balances.byMember[me] ?? 0 : undefined,
    };
  }, [rows, me]);
}

/**
 * Keys held for groups never seen: an icon arrives carrying its invites, and
 * without this its first launch shows the empty state. Minus `leftGroups`.
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

export function useGroupSummaries(): GroupSummary[] | undefined {
  return useLive("groupSummaries", groupSummaries, []);
}

/** The list a launch that reopened a group goes back to. */
export function warmGroupsList(): void {
  keepWarm("groupSummaries", groupSummaries, []);
}

async function groupSummaries(): Promise<GroupSummary[]> {
  const d = db();
  const [groups, device, keys] = await Promise.all([
    d.groups.toArray(),
    d.device.get("device"),
    d.groupKeys.toArray(),
  ]);
  const newCount = async (groupId: string): Promise<number> => {
    const key = keys.find((k) => k.groupId === groupId);
    if (!device || key?.seenSeq === undefined || key.lastSeq <= key.seenSeq) return 0;
    const ops = await d.ops.where("groupId").equals(groupId).toArray();
    return unseenRevisions(ops, key.seenSeq, device.nodeId, Date.now() - CATCH_UP_MS)
      .revisions.length;
  };
  // An edit, a delete or a back-dated expense is activity too.
  const lastChanged = async (group: Group): Promise<number> => {
    const newest = await d.ops.where("[groupId+hlc]")
      .between([group.id, Dexie.minKey], [group.id, Dexie.maxKey]).last();
    return newest ? parseHlc(newest.hlc).physical : group.createdAt;
  };

  // This list is "your groups", not every group the device has synced.
  const left = new Set(device?.leftGroups ?? []);
  const out = await Promise.all(groups.filter((group) => !left.has(group.id)).map(async (group) => ({
    group,
    me: device?.meByGroup[group.id],
    newCount: await newCount(group.id),
    lastActivity: await lastChanged(group),
  })));
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * **Never `navigator.onLine`**: a 500, a D1 outage or a rejected key all look
 * "online". This reads what the engine recorded.
 */
interface SyncHealth {
  failing: boolean;
  /** Retrying cannot fix it; a fresh link can. */
  rejected: boolean;
  lastSyncedAt: number | undefined;
}

/**
 * One failure is a dropped packet on a train; two, spaced by backoff, is a server
 * that isn't there.
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
 * Only the browser knows it (dev and self-hosted Workers differ), so it can't be
 * baked into the export.
 */
export function useHost(): string {
  const [host, setHost] = useState("");
  useEffect(() => setHost(location.host), []);
  return host;
}

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
