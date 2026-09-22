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
   * Groups this device has forgotten: hidden from this phone's list, shared
   * data and `groupKeys` secret untouched. Forgetting is a per-device "not on
   * my list any more", never a claim about the group, so it is never logged.
   * Opening the invite link again clears an entry back out (`saveGroupKey`).
   */
  leftGroups?: string[];
  /**
   * Groups this phone knows are deleted: gone from the server, and gone here
   * since `eraseGroupLocally` ran. Bare ids, so a screen opened on one — or an
   * old invite link tapped again — can say the group was deleted rather than
   * let it quietly vanish. The id says nothing about what was in it.
   */
  deletedGroups?: string[];
  theme: "system" | "light" | "dark";
  /** The group this device most recently opened — seeds a new group's currency. */
  lastOpenedGroupId?: string;
  /**
   * True while the groups list is the last screen this device was on, so a
   * launch leaves it there instead of reopening `lastOpenedGroupId` — backing
   * out of a group is how you say you are done with it. Absent reads as "in
   * the group". See lib/launch.ts.
   */
  leftOnList?: boolean;
  /**
   * True while the install offer on the groups list is folded shut. A collapse
   * and **not** a dismissal: the card never leaves, because persisting storage
   * is worth a standing ask and only installing should end it
   * (components/install.tsx). Absent reads as open.
   */
  installNudgeCollapsed?: boolean;
  /**
   * True while a scanned bill's lines are read in English rather than in the
   * language the receipt was printed in. Absent reads as the original, which
   * is the default everywhere — see `billLabel` (lib/scan/items.ts).
   *
   * Device-local because it is how one person reads, not a fact about the
   * bill: the expense keeps both labels and two phones at the same table may
   * want different ones.
   */
  billEnglish?: boolean;
  /**
   * What this phone scans with when it is not in a group — a quick split
   * ([ADR-0035](../../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
   *
   * An id and a secret shaped like a group's, because that is what the scan
   * endpoint authenticates, and deliberately **not** in `groupKeys` — that is
   * the table the sync engine walks. One per phone, minted on first need and
   * never rotated. See lib/quick.ts.
   */
  scan?: { id: string; secret: string };
  /**
   * A Gemini API key this phone brought itself, pasted on `/advanced`. While it
   * is set, a scan never touches our Worker: the phone calls Google directly,
   * so no shared budget is spent, no Turnstile token is minted, and our server
   * has no record of it (docs/receipt-scanning.md#a-key-of-your-own). Absent
   * reads as "use the shared key".
   *
   * **Never an op.** It is one person's credential and their bill, not the
   * group's, so it never leaves this phone. It sits in IndexedDB in the clear
   * beside the group secrets, which is what `/advanced` says out loud rather
   * than implying a vault.
   */
  geminiKey?: string;
  /**
   * Scans this phone has spent in the last day, per caller — its own copy of
   * `SCAN_LIMITS.caller`, so one already over budget is refused before a
   * request is made (lib/scan/budget.ts). Advice only: the Worker counts again
   * and decides.
   */
  scanLog?: { id: string; at: number }[];
  /**
   * The fingerprint of the demo seed this phone was given, `demoStamp()` at the
   * time it was laid down. A build whose seed reads differently replaces the
   * demo rather than reopening a story we stopped telling
   * (lib/db/commands/demo.ts). Absent re-seeds.
   */
  demoSeed?: string;
}

/**
 * A run of consecutive failed sync attempts, cleared by the next success.
 * `count` exists so the UI can tell a blip from an outage: one failure is a
 * dropped packet, two is worth saying out loud.
 */
interface SyncFailure {
  count: number;
  at: number;
  /** HTTP status, when the request got that far. 403 never heals on its own. */
  status?: number;
}

/**
 * What a pull had to skip, because skipping quietly is how ops go missing.
 * `fromSeq` is the earliest: the cursor has moved past it, so winding `lastSeq`
 * back to `fromSeq - 1` is how a later build — one that can read what this one
 * couldn't — gets a second look. The ops are still on the server.
 */
export interface Unreadable {
  count: number;
  fromSeq: number;
  at: number;
}

/**
 * The group secret from the invite link. Device-local and deliberately in a
 * table of its own: it must never be foldable from an op, or it would sync to
 * the server, which is the one place it must never be. ADR-0003.
 */
interface GroupKey {
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
  /**
   * Ops the server handed over that this device could not open, skipped so the
   * rest of the pull could land. Not indexed, like the two above.
   */
  unreadable?: Unreadable;
}

/**
 * **Never rename the database.** `hajsik` is the address every phone's groups
 * are already stored at; a new name opens an empty database beside the real
 * one, and every existing install launches with no groups and no way to ask
 * for them back.
 */
class BidaDb extends Dexie {
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
   * `[groupId+id]`, **never `id` alone** — that is the device's HLC node id,
   * the same string in every group this phone is in, so a device in two groups
   * would share one row and re-folding either would clobber the other's claim.
   */
  identities!: Table<Identity, [string, string]>;
  /**
   * The groups' exchange-rate registries. An `ExchangeRate` is identified by
   * its currency code rather than a random id, so the primary key is
   * `[groupId+id]`: two trips both spending in MAD are two rows.
   */
  rates!: Table<ExchangeRate, [string, string]>;

  constructor() {
    super("hajsik"); // deliberately not "bida" — see above
    /** The schema, declared once. How it got this shape is the git log's job. */
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
      // Runs once per phone. Encryption (ADR-0036) wiped the server's copy of
      // every group, so the phone re-offers its whole log sealed and asks for
      // the group back from sequence zero. Without it a group looks healthy and
      // is an island: nothing left to push, and a cursor pointing past the end
      // of a log that starts again at 1.
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
    // `indexedDB.open` has no timeout and can take seconds on a phone that has
    // just woken up — one of the three things a skeleton could mean
    // (lib/diag.ts).
    const opened = started("db.open");
    instance.on("ready", () => opened(`v${instance?.verno ?? "?"}`), false);
  }
  return instance;
}
