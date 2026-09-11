import Dexie, { type Table } from "dexie";
import { upgradeReceiptSplit } from "@hajsik/core";
import type {
  Attachment,
  ExchangeRate,
  Expense,
  Group,
  Identity,
  Member,
  Op,
  Settlement,
} from "@hajsik/core";

/**
 * The op log is the truth. Every other table in here is a materialised view of
 * it and can be thrown away and rebuilt — see `rebuild()` in ./fold.ts.
 *
 * IndexedDB can't index `null`, so "not yet pushed to the server" is carried by
 * a numeric `pending` flag rather than by `seq === null`.
 */
export interface StoredOp extends Op {
  /** 1 while the server hasn't accepted this op. Indexed; `seq` is not. */
  pending: number;
}

/** Device-local, never synced: who "you" are, and this device's clock. */
export interface DeviceRecord {
  key: "device";
  /** HLC tiebreak id. Stable for the life of the install. */
  nodeId: string;
  hlcPhysical: number;
  hlcCounter: number;
  /** groupId -> the member this device belongs to. */
  meByGroup: Record<string, string>;
  /**
   * Groups this device has forgotten. Hidden from the groups list on this
   * phone even though the shared data (and this device's `groupKeys` secret,
   * if it still has one) is untouched — forgetting is a per-device "not on my
   * list any more", not a claim about what happened to the group itself, and
   * it's never logged. Absent on records written before this existed.
   * Opening the invite link again clears an entry back out (`saveGroupKey`).
   */
  leftGroups?: string[];
  theme: "system" | "light" | "dark";
  /** The group this device most recently opened — seeds a new group's currency. */
  lastOpenedGroupId?: string;
}

/**
 * A run of consecutive failed sync attempts, cleared by the next success.
 * `count` exists so the UI can tell a blip from an outage: one failure is a
 * dropped packet, two is worth saying out loud.
 */
export interface SyncFailure {
  count: number;
  at: number;
  /** HTTP status, when the request got that far. 403 never heals on its own. */
  status?: number;
}

/**
 * The group secret from the invite link. Device-local and deliberately in a
 * table of its own: it must never be foldable from an op, or it would sync to
 * the server, which is the one place it must never be. ADR-0003.
 */
export interface GroupKey {
  groupId: string;
  secret: string;
  /** Highest server seq pulled. The sync cursor. */
  lastSeq: number;
  /** When a push+pull last completed. Absent until this device's first one. */
  lastSyncedAt?: number;
  /**
   * Set while sync is failing. Neither this nor `lastSyncedAt` is indexed, so
   * they need no schema version — Dexie only declares the fields it indexes.
   */
  failure?: SyncFailure;
}

export class HajsikDb extends Dexie {
  ops!: Table<StoredOp, string>;
  groups!: Table<Group, string>;
  members!: Table<Member, string>;
  expenses!: Table<Expense, string>;
  settlements!: Table<Settlement, string>;
  attachments!: Table<Attachment, string>;
  device!: Table<DeviceRecord, string>;
  groupKeys!: Table<GroupKey, string>;
  /**
   * Materialised from `identity` ops: one row per device, per group. Keyed by
   * `[groupId+id]` because `id` is the device's HLC node id, which is the same
   * string in every group this phone is in — keyed by that alone, a device in
   * two groups had one row and re-folding either group clobbered the other's
   * claim.
   */
  identities!: Table<Identity, [string, string]>;
  /**
   * The groups' exchange-rate registries. Rows are keyed by something a person
   * chose rather than by a random id — an `ExchangeRate` is identified by its
   * currency code — so its primary key is `[groupId+id]`: two trips both
   * spending in MAD are two rows, not one that they fight over.
   */
  rates!: Table<ExchangeRate, [string, string]>;

  constructor() {
    super("hajsik");
    this.version(1).stores({
      ops: "id, groupId, entityId, hlc, pending, [groupId+hlc]",
      groups: "id, archivedAt",
      members: "id, groupId",
      expenses: "id, groupId, occurredAt, [groupId+occurredAt]",
      settlements: "id, groupId, occurredAt, [groupId+occurredAt]",
      attachments: "id, groupId, expenseId, uploadState",
      device: "key",
      groupKeys: "groupId",
    });
    // v2 added `identityLog`, a device-local table of identity changes. Only
    // the tables that change are listed — Dexie carries the rest forward.
    this.version(2).stores({
      identityLog: "++id, groupId, at",
    });
    // v3 replaces it with `identities`, materialised from `identity` ops:
    // who a device says it is became a shared fact, so the log of it is the
    // op log like everything else (ADR-0003). The old
    // table is dropped rather than migrated — its rows have no ops behind
    // them, and the shared record honestly starts here.
    this.version(3).stores({
      identities: "id, groupId",
      identityLog: null,
    });
    // v4 adds the group's exchange-rate registry (ADR-0005). Materialised from
    // `rate` ops like everything else, so there is nothing to migrate: a phone
    // that upgrades has an empty table until the log gives it rows, and every
    // foreign entry keeps converting at the rate it was saved with until then.
    this.version(4).stores({
      rates: "[groupId+id], groupId",
    });
    // v5/v6 re-key `identities` by `[groupId+id]`. Its `id` is the device's
    // HLC node id — one string per install, the same in every group — so keyed
    // by that alone a phone in two groups had one row, and re-folding either
    // group deleted the other group's claim.
    //
    // Two versions because Dexie refuses to change a table's primary key in
    // place ("Not yet support for changing primary key"): drop, then recreate,
    // exactly as `identityLog` did. Nothing is migrated and nothing is lost —
    // the materialised tables are a cache of the op log, and `rebuild()`
    // refills this one from the `identity` ops that are the real record.
    this.version(5).stores({ identities: null });
    this.version(6).stores({ identities: "[groupId+id], groupId" });
    // v7 brings stored expenses to the shape the fold now produces: a receipt
    // split is its own `SplitMode` rather than `shares` beside a `splitTab`
    // flag (ADR-0016). No table changes — these rows are a cache of the op
    // log, and this is the same upgrade the fold applies to the ops behind
    // them. Done here rather than left to `rebuild()`, which only runs when a
    // pull brings ops: a phone that syncs nothing new would have gone on
    // calling its own scanned bills "as parts".
    this.version(7).upgrade(async (tx) => {
      await tx.table("expenses").toCollection()
        .modify((expense: Record<string, unknown>) => upgradeReceiptSplit(expense));
    });
  }
}

/**
 * One connection per tab. Constructed lazily so that importing this module
 * during a static export (where there is no indexedDB) doesn't throw.
 */
let instance: HajsikDb | undefined;

export function db(): HajsikDb {
  if (!instance) instance = new HajsikDb();
  return instance;
}
