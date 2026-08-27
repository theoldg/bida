import Dexie, { type Table } from "dexie";
import type {
  Attachment,
  Expense,
  Group,
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
  personalMode: boolean;
  /** groupId -> the member this device belongs to. */
  meByGroup: Record<string, string>;
  theme: "system" | "light" | "dark";
}

/**
 * Who this device said it was, over time, per group.
 *
 * Device-local and never an op: which member is holding this phone is a fact
 * about the phone, not about the group, and pushing it would tell everyone
 * else's ledger something it has no business knowing. Appended by `setMe`,
 * rendered by the in-group options screen. ADR-0009.
 */
export interface IdentityEntry {
  /** Auto-incremented by Dexie; also the display order. */
  id?: number;
  groupId: string;
  at: number;
  /** The member this device was before, or null on a first claim. */
  fromMember: string | null;
  toMember: string;
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
  identityLog!: Table<IdentityEntry, number>;

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
    // v2 adds the device-local identity log. Existing tables are repeated
    // unchanged because Dexie treats a version's schema as the whole picture.
    this.version(2).stores({
      identityLog: "++id, groupId, at",
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
