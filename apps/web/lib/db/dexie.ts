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
 * The op log is the truth; every other folded table can be rebuilt from it
 * (`rebuild()` in ./fold.ts).
 */
export interface StoredOp extends Op {
  /** 1 until the server accepts the op. A number because IndexedDB can't index `null`. */
  pending: number;
}

/** Device-local, never synced. */
export interface DeviceRecord {
  key: "device";
  /** HLC tiebreak id, stable for the life of the install. */
  nodeId: string;
  hlcPhysical: number;
  hlcCounter: number;
  meByGroup: Record<string, string>;
  /** Hidden from the list, data kept. Opening the invite again clears it (`saveGroupKey`). */
  leftGroups?: string[];
  /** Deleted on the server and erased here, kept so an old link can say "deleted". */
  deletedGroups?: string[];
  theme: "system" | "light" | "dark";
  /** Seeds a new group's currency. */
  lastOpenedGroupId?: string;
  /** Launch on the groups list rather than reopening the last group (lib/launch.ts). */
  leftOnList?: boolean;
  /** Folded, not dismissed: only installing ends the offer. */
  installNudgeCollapsed?: boolean;
  /** Its own field: on Android the tab and the installed app share this row. */
  notifyNudgeCollapsed?: boolean;
  /**
   * What this phone scans with outside a group (lib/scan/credential.ts). Not in
   * `groupKeys`, which sync walks.
   */
  scan?: { id: string; secret: string };
  /** A pasted Gemini key: scans go straight to Google. Never an op, never leaves the phone. */
  geminiKey?: string;
  /** Advice only, the Worker decides (lib/scan/budget.ts). */
  scanLog?: { id: string; at: number }[];
  /** `demoStamp()` of the seeded demo; a build whose seed differs re-seeds it. */
  demoSeed?: string;
}

interface SyncFailure {
  /** Consecutive failures: tells a blip from an outage. */
  count: number;
  at: number;
  /** 403 never heals on its own. */
  status?: number;
}

/**
 * Ops a pull had to skip. Winding `lastSeq` back to `fromSeq - 1` gives a later
 * build a second look; the ops are still on the server.
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

/** A table of its own so the secret can never be folded from an op and synced (ADR-0003). */
interface GroupKey {
  groupId: string;
  secret: string;
  /** The sync cursor. */
  lastSeq: number;
  /** Highest seq shown on the new-edits line; a joining group starts with nothing new. */
  seenSeq?: number;
  lastSyncedAt?: number;
  failure?: SyncFailure;
  unreadable?: Unreadable;
}

/**
 * A command's notifications, held until its ops have landed: a notification
 * about an entry nobody can pull yet would open to nothing (docs/notifications.md).
 */
interface PendingNotices {
  id: string;
  groupId: string;
  opIds: string[];
  notices: Notice[];
  createdAt: number;
}

/** Every phone's groups already live under this name; a new one would open empty. */
const DB_NAME = "hajsik";

class BidaDb extends Dexie {
  ops!: Table<StoredOp, string>;
  groups!: Table<Group, string>;
  members!: Table<Member, string>;
  expenses!: Table<Expense, string>;
  settlements!: Table<Settlement, string>;
  attachments!: Table<Attachment, string>;
  device!: Table<DeviceRecord, string>;
  groupKeys!: Table<GroupKey, string>;
  /** Keyed per group: the HLC node id is the same in every group. */
  identities!: Table<Identity, [string, string]>;
  /** Keyed per group: the id is the currency code. */
  rates!: Table<ExchangeRate, [string, string]>;
  notices!: Table<PendingNotices, string>;

  constructor() {
    super(DB_NAME);
    // Only indexed fields are declared, so adding an unindexed one needs no version.
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
      // The encryption reset (ADR-0036) emptied the server: re-offer the whole
      // log sealed and pull from zero.
      await tx.table("ops").toCollection().modify({ pending: 1, seq: null });
      await tx.table("groupKeys").toCollection().modify({ lastSeq: 0 });
    });
    this.version(9).stores({ notices: "id, groupId" });
  }
}

/** Lazy, so importing this during the static export (no indexedDB) doesn't throw. */
let instance: BidaDb | undefined;

export function db(): BidaDb {
  if (!instance) {
    instance = new BidaDb();
    // `indexedDB.open` can take seconds on a phone that just woke (lib/diag.ts).
    const opened = started("db.open");
    instance.on("ready", () => opened(`v${instance?.verno ?? "?"}`), false);
  }
  return instance;
}
