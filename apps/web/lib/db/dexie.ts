import Dexie, { type Table } from "dexie";
import { started } from "../diag";
import type {
  Attachment,
  ExchangeRate,
  Expense,
  Group,
  Identity,
  Member,
  Notice,
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
   * Groups this device has forgotten: hidden from this list, data and secret
   * untouched. A per-device choice, never logged. Opening the invite link again
   * clears it (`saveGroupKey`).
   */
  leftGroups?: string[];
  /**
   * Groups this phone knows are deleted from the server, and erased here
   * (`eraseGroupLocally`). Bare ids, so a screen or an old invite link can say
   * "deleted" rather than let the group quietly vanish.
   */
  deletedGroups?: string[];
  theme: "system" | "light" | "dark";
  /** The group this device most recently opened — seeds a new group's currency. */
  lastOpenedGroupId?: string;
  /**
   * True while the groups list is the last screen this device was on, so a
   * launch stays there rather than reopening `lastOpenedGroupId`. Absent reads
   * as "in the group". See lib/launch.ts.
   */
  leftOnList?: boolean;
  /**
   * True while the install offer is folded shut. A collapse, **not** a
   * dismissal: only installing ends it (components/install.tsx). Absent is open.
   */
  installNudgeCollapsed?: boolean;
  /**
   * The same for the notifications offer, which stands where the install offer
   * did once the app is installed. Its own field: on Android the tab and the
   * app share this row, and folding one offer isn't folding the other.
   */
  notifyNudgeCollapsed?: boolean;
  /**
   * True while scanned bills are read in English rather than as printed.
   * Absent is the original — see `billLabel` (lib/scan/items.ts). Device-local:
   * the expense keeps both labels, and two phones may want different ones.
   */
  billEnglish?: boolean;
  /**
   * What this phone scans with outside a group — a quick split
   * ([ADR-0035](../../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
   * Shaped like a group's id and secret, because that is what the scan endpoint
   * authenticates, and **not** in `groupKeys`, which sync walks. Minted on first
   * need, never rotated. See lib/quick.ts.
   */
  scan?: { id: string; secret: string };
  /**
   * A Gemini API key pasted on `/advanced`. While set, scans call Google
   * directly — no shared budget, no Turnstile, no record on our server
   * (docs/scan-worker.md#a-key-of-your-own).
   *
   * **Never an op**: one person's credential, never leaves this phone. Stored in
   * the clear beside the group secrets, which `/advanced` says out loud.
   */
  geminiKey?: string;
  /**
   * Scans this phone spent in the last day, per caller — a local copy of
   * `SCAN_LIMITS.caller`, so an over-budget scan is refused before the request
   * (lib/scan/budget.ts). Advice only: the Worker decides.
   */
  scanLog?: { id: string; at: number }[];
  /**
   * `demoStamp()` of the demo seed this phone holds. A build whose seed differs
   * replaces the demo (lib/db/commands/demo.ts). Absent re-seeds.
   */
  demoSeed?: string;
}

/**
 * A run of consecutive failed sync attempts, cleared by a success. `count`
 * tells a blip from an outage.
 */
interface SyncFailure {
  count: number;
  at: number;
  /** HTTP status, when the request got that far. 403 never heals on its own. */
  status?: number;
}

/**
 * What a pull had to skip, because skipping quietly is how ops go missing.
 * `fromSeq` is the earliest: winding `lastSeq` back to `fromSeq - 1` gives a
 * later build a second look. The ops are still on the server.
 */
export interface Unreadable {
  count: number;
  fromSeq: number;
  at: number;
  /** The `VERSION` that skipped them. Any other build rewinds once (`sync.ts`). */
  build?: string;
  /** When the earliest op held back for a stamp too far ahead stops being so. */
  retryAt?: number;
}

/**
 * The group secret from the invite link. In a table of its own so it can never
 * be folded from an op — which would sync it to the server. ADR-0003.
 */
interface GroupKey {
  groupId: string;
  secret: string;
  /** Highest server seq pulled. The sync cursor. */
  lastSeq: number;
  /**
   * Highest seq this phone has shown on the ledger's new-edits line
   * (components/new-edits.tsx). Set to the cursor by the first pull that finds
   * it absent, so a group joins with nothing new; never synced.
   */
  seenSeq?: number;
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
 * What one command of this phone's owes the rest of the group
 * (docs/notifications.md), kept until the ops that caused it have landed —
 * a notification about an entry nobody can pull yet would open to nothing.
 * Facts, not words: they are written at send time, with the names of then.
 */
export interface PendingNotices {
  id: string;
  groupId: string;
  /** The command's ops. Sent once every one is on the server. */
  opIds: string[];
  notices: Notice[];
  createdAt: number;
}

/**
 * **Never rename the database.** `hajsik` is where every phone's groups
 * already live; a new name opens an empty database and every install
 * launches with no groups.
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
   * `[groupId+id]`, **never `id` alone** — the HLC node id is the same in every
   * group, so re-folding one group would clobber another's claim.
   */
  identities!: Table<Identity, [string, string]>;
  /**
   * The groups' exchange-rate registries, keyed `[groupId+id]` since the id is
   * the currency code: two groups spending MAD are two rows.
   */
  rates!: Table<ExchangeRate, [string, string]>;
  /** Device-local like `groupKeys`: never folded, never synced. */
  notices!: Table<PendingNotices, string>;

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
      // Runs once per phone: the encryption reset (ADR-0036) emptied the server,
      // so re-offer the whole log sealed and pull from zero. Without it a group is
      // an island with nothing to push and a cursor past the end of the new log.
      await tx.table("ops").toCollection().modify({ pending: 1, seq: null });
      await tx.table("groupKeys").toCollection().modify({ lastSeq: 0 });
    });
    // Adds a table and nothing else, so it carries no upgrade; 8 keeps its own
    // for a phone that skips straight here.
    this.version(9).stores({ notices: "id, groupId" });
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
