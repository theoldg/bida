import Dexie, { type Table } from "dexie";
import { started } from "../diag";
import type {
  Attachment,
  ExchangeRate,
  Expense,
  Group,
  Identity,
  Member,
  Op,
  Settlement,
} from "@bida/core";

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
  /**
   * True while the groups list is the last screen this device was on, so a
   * launch leaves it there instead of reopening `lastOpenedGroupId` — backing
   * out of a group is how you say you are done with it. Absent on records
   * written before this existed, which reads as "in the group", the behaviour
   * those records already had. See lib/launch.ts.
   */
  leftOnList?: boolean;
  /**
   * True while the install offer on the groups list is folded shut. It is a
   * collapse and not a dismissal: the card never leaves, because persisting
   * storage is worth a standing ask and installing is the only thing that
   * should end it (components/install.tsx). Absent on records written before
   * this existed, which reads as open — the behaviour those records had.
   */
  installNudgeCollapsed?: boolean;
  /**
   * What this phone scans with when it is not in a group — a quick split
   * ([ADR-0035](../../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
   *
   * An id and a secret shaped exactly like a group's, because that is what the
   * scan endpoint authenticates, and deliberately **not** in `groupKeys`,
   * which is the table the sync engine walks. One per phone, minted on first
   * need and never rotated; whether the *server* has seen it is not recorded
   * here, since introducing it is part of every scan. See lib/quick.ts.
   */
  scan?: { id: string; secret: string };
  /**
   * A Gemini API key this phone brought itself, pasted on `/advanced`.
   *
   * While it is set, a scan never touches our Worker: the phone builds the
   * envelope and calls Google directly, so no shared budget is spent, no
   * Turnstile token is minted, and our server has no record that anything was
   * scanned (docs/receipt-scanning.md#a-key-of-your-own). Absent on records
   * written before this existed, and on every phone that never pasted one,
   * which reads as "use the shared key" — what the app has always done.
   *
   * Device-local like everything else in this record, and deliberately so: it
   * is one person's credential and their bill, not the group's, so it is never
   * an op and never leaves this phone. It sits in IndexedDB in the clear,
   * beside the group secrets, which is what `/advanced` says out loud rather
   * than implying a vault.
   */
  geminiKey?: string;
  /**
   * Scans this phone has spent in the last day, per caller — its own copy of
   * `SCAN_LIMITS.caller`, so a scan already over budget is refused before a
   * request is made rather than after (lib/scan/budget.ts). Advice: the Worker
   * counts again and decides. Absent on records written before this existed,
   * which reads as "no scans yet".
   */
  scanLog?: { id: string; at: number }[];
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

/**
 * The IndexedDB database is still named `hajsik`, from before the app was
 * called bida. It stays that way: the name is the address every phone's groups
 * are already stored at, and renaming it opens an empty database next to the
 * real one — every existing install would launch with no groups and no way to
 * ask for them back. A brand is not worth that.
 */
export class BidaDb extends Dexie {
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
    super("hajsik"); // deliberately not "bida" — see above
    /**
     * One version, where there used to be seven.
     *
     * The chain that got here described upgrades every phone has long since
     * run — a device-local identity log and its replacement by `identity` ops,
     * the rate registry, two re-keyings of `identities`, and the receipt-split
     * rewrite — and none of it could still fire. Declaring the schema once is
     * what this file is for; the history of how it got that shape is the git
     * log's job.
     */
    this.version(8).stores({
      ops: "id, groupId, entityId, hlc, pending, [groupId+hlc]",
      groups: "id, archivedAt",
      members: "id, groupId",
      expenses: "id, groupId, occurredAt, [groupId+occurredAt]",
      settlements: "id, groupId, occurredAt, [groupId+occurredAt]",
      attachments: "id, groupId, expenseId, uploadState",
      device: "key",
      groupKeys: "groupId",
      identities: "[groupId+id], groupId",
      rates: "[groupId+id], groupId",
    }).upgrade(async (tx) => {
      // The one thing the collapse *does* do, and it runs once per phone.
      //
      // Encryption (ADR-0036) changed what the server stores, so its copy of
      // every group was wiped the day it landed. The ops are still here — this
      // table is the truth and the server is a relay — so the phone re-offers
      // its whole log, sealed this time, and asks for the group back from
      // sequence zero. Without it a group would look healthy and be an island:
      // nothing left to push, and a cursor pointing past the end of a log that
      // starts again at 1.
      await tx.table("ops").toCollection().modify({ pending: 1, seq: null });
      await tx.table("groupKeys").toCollection().modify({ lastSeq: 0 });
    });
  }
}

/**
 * One connection per tab. Constructed lazily so that importing this module
 * during a static export (where there is no indexedDB) doesn't throw.
 */
let instance: BidaDb | undefined;

export function db(): BidaDb {
  if (!instance) {
    instance = new BidaDb();
    // How long the first read waits before it has even started. `indexedDB.open`
    // has no timeout and can take seconds on a phone that has just woken up —
    // one of the three things a skeleton on screen could mean (lib/diag.ts).
    const opened = started("db.open");
    instance.on("ready", () => opened(`v${instance?.verno ?? "?"}`), false);
  }
  return instance;
}
