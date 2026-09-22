import { convertMinor, minorToDecimalString } from "./money.js";
import type { OpDraft } from "./invariants.js";
import { colorSeedFor, memberIdFor } from "./names.js";
import type { Id, SplitSpec } from "./types.js";

/**
 * The demo group: a real group, made of real ops, that never syncs.
 *
 * **Nothing downstream knows it is a demo.** These are ordinary drafts,
 * appended and folded like any other log, so every screen works for the
 * ordinary reason. What makes it a demo is what the *caller* leaves out — no
 * `saveGroupKey`, so no key row, so `runSyncAll` never sees it. There is no
 * flag to flip (docs/sync.md#the-demo-group-has-no-key).
 *
 * The cast is four travellers haggling over passage off Tatooine. A story
 * rather than a trip: the demo is the pitch, and a stranger reads a story
 * faster than a spreadsheet. Dates are offsets from `now`, so it never
 * reads stale.
 */

/**
 * The demo's group id. A constant, so `/demo` is idempotent for free: opening
 * it twice reopens the one group instead of stacking copies. Shaped like
 * `newGroupId()`'s 12 base36 characters so ids are one kind of thing
 * everywhere, and readable on purpose — a group with no key is one the server
 * cannot be told about, so there is nothing to keep secret or to collide over.
 */
export const DEMO_GROUP_ID = "demodemodemo";

/** Is this the demo? The one question anything outside this module may ask. */
export function isDemo(groupId: string | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

/** The four at the booth. The device is Luke, or the personal lens is blank. */
export const DEMO_NAMES = ["Luke", "Han", "Chewie", "Ben"] as const;
type DemoName = (typeof DEMO_NAMES)[number];

/** The member the device speaks for: the demo is a group you are already in. */
export const DEMO_ME: DemoName = "Luke";

/** Credits, and the local coin the spaceport actually takes. */
const DEMO_CURRENCY = "CRD";
const DEMO_FOREIGN = "WUP";
/** Sixteen wupiupi to the credit, as the moneychanger by the door has it. */
const DEMO_RATE = "0.0625";

/**
 * What the caller cannot be assumed to have: the device's own HLC node id.
 * The member ids and avatar hues are `memberIdFor`/`colorSeedFor` of the
 * constant group id, so this module can mint them itself — which is what lets
 * `demoStamp` fingerprint the seed without a caller.
 */
export interface DemoCast {
  /** Member id per name, from `memberIdFor(DEMO_GROUP_ID, name)`. */
  ids: Record<DemoName, Id>;
  /** Avatar hue per name, from `colorSeedFor(DEMO_GROUP_ID, name)`. */
  colorSeeds: Record<DemoName, number>;
  /** The device's HLC node id, so the identity claim is this phone's own. */
  deviceNodeId: Id;
}

/** The cast every phone derives identically, given the device's node id. */
export function demoCast(deviceNodeId: Id): DemoCast {
  const ids = {} as Record<DemoName, Id>;
  const colorSeeds = {} as Record<DemoName, number>;
  for (const name of DEMO_NAMES) {
    ids[name] = memberIdFor(DEMO_GROUP_ID, name);
    colorSeeds[name] = colorSeedFor(DEMO_GROUP_ID, name);
  }
  return { ids, colorSeeds, deviceNodeId };
}

const DAY = 86_400_000;

/** Local midnight `daysAgo` days back: an entry carries a day, not an hour. */
function dayBefore(now: number, daysAgo: number): number {
  const d = new Date(now - daysAgo * DAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Entity ids are fixed, so re-seeding writes the same group rather than a second one. */
const ENTRY = {
  passage: "demo-passage",
  cantina: "demo-cantina",
  docking: "demo-docking",
  dejarik: "demo-dejarik",
  speeder: "demo-speeder",
  greedo: "demo-greedo",
  advance: "demo-advance",
} as const;

/**
 * The bill behind the cantina tab: what the booth ordered, and who ordered it.
 * One table, read three ways — printed lines, grid, split weights — rather
 * than three lists that have to be kept agreeing.
 *
 * **The tab is written in the local tongue**, with the English beside it, so
 * the demo carries the one thing a bill in your own language cannot show: the
 * translation icon on the who-had-what bar, and the same lines reading both
 * ways ([ADR-0016](../../../docs/decisions/0016-receipts.md)).
 *
 * **Every line must divide evenly** among the people on it: the
 * largest-remainder tiebreak for a leftover cent lives in the web's
 * `receiptBreakdown`, so a line that needed it would quote a figure core
 * cannot check. `scan/items.test.ts` holds the readings to each other.
 */
const DEMO_BILL: readonly {
  label: string; labelEn: string; minor: number; quantity?: number; who: readonly DemoName[];
}[] = [
  { label: "Jawa hoopa", labelEn: "Jawa juice", minor: 2_400, quantity: 2, who: ["Luke", "Han"] },
  { label: "Bunta koosa", labelEn: "Blue milk", minor: 900, who: ["Ben"] },
  { label: "Ardees jeeska", labelEn: "Tall glass of ardees", minor: 1_600, who: ["Chewie"] },
  { label: "Doopee da Modal Nodes", labelEn: "For the Modal Nodes", minor: 2_000, who: DEMO_NAMES },
  { label: "Wabba kroba, da nudchaa", labelEn: "Back booth, the quiet one", minor: 1_200, who: DEMO_NAMES },
];

/** What each person's own lines come to: the tab's split, itemised. */
function billWeights(ids: Record<DemoName, Id>): Record<Id, number> {
  const weights: Record<Id, number> = {};
  for (const line of DEMO_BILL) {
    for (const name of line.who) {
      weights[ids[name]] = (weights[ids[name]] ?? 0) + line.minor / line.who.length;
    }
  }
  return weights;
}

/**
 * The whole evening, as one batch of drafts. Deterministic in `cast` and `now`,
 * which is what makes *reset* and *clear, then reopen* the same call twice.
 *
 * The contents are chosen so every screen has something to say: a plain
 * expense, one with two payers and its bill itemised, one in local coin priced
 * by a group rate, one that leaves two people out, an income, a transfer, one
 * entry edited in two fields and one deleted. The balances deliberately do not
 * cancel, so settle-up proposes transfers rather than "all square".
 */
export function demoOps(cast: DemoCast, now: number): OpDraft[] {
  const { ids } = cast;
  const all = DEMO_NAMES.map((name) => ids[name]);
  const equal = (members: readonly Id[]): SplitSpec => ({ mode: "equal", members: [...members] });
  /** An amount in spaceport coin, as the registry prices it today. */
  const inWup = (minor: number) => ({
    amountMinor: minor,
    currency: DEMO_FOREIGN,
    rateToBase: DEMO_RATE,
    baseAmountMinor: convertMinor(minor, DEMO_FOREIGN, DEMO_CURRENCY, DEMO_RATE),
  });
  const inCredits = (minor: number) => ({
    amountMinor: minor,
    currency: DEMO_CURRENCY,
    rateToBase: "1",
    baseAmountMinor: minor,
  });

  return [
    {
      entity: "group",
      entityId: DEMO_GROUP_ID,
      kind: "create",
      patch: {
        name: "Passage to Alderaan",
        baseCurrency: DEMO_CURRENCY,
        createdAt: dayBefore(now, 9),
        archivedAt: null,
      },
    },
    ...DEMO_NAMES.map((name): OpDraft => ({
      entity: "member",
      entityId: ids[name],
      kind: "create",
      patch: { name, colorSeed: cast.colorSeeds[name], deletedAt: null },
    })),
    // This phone is Luke. Without it the ledger's personal lens has nothing to
    // be personal about, and the claim gate would stop the demo at the door.
    {
      entity: "identity",
      entityId: cast.deviceNodeId,
      kind: "create",
      patch: { memberId: ids[DEMO_ME], claimedAt: dayBefore(now, 9) },
    },
    // The group's rate registry: what spaceport coin is worth, for everybody,
    // now. One row, so /g/rates has something to show and correcting it moves
    // every WUP entry in the ledger (ADR-0005).
    {
      entity: "rate",
      entityId: DEMO_FOREIGN,
      kind: "create",
      patch: {
        rate: DEMO_RATE, source: "typed", asOf: dayBefore(now, 8), deletedAt: null,
      },
    },

    // The charter, somebody else fronted: the row the personal lens colours
    // red, and the one that leaves the crew out — Han and Chewie are being
    // paid, not splitting it.
    {
      entity: "expense",
      entityId: ENTRY.passage,
      kind: "create",
      patch: {
        description: "Passage to Alderaan",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inCredits(1_500_000),
        paidBy: ids.Ben,
        split: equal([ids.Ben, ids.Luke]),
      },
    },
    // Two payers on one tab: `paidBy` is the larger of them (core/payers.ts).
    // It is also the itemised one — the bill is kept on the entry, so the
    // split is what each of them ordered rather than a quarter each, and the
    // entry screen can open anybody's row onto their own lines (ADR-0016).
    // Every line divides evenly, so the weights below are the only reading
    // `receiptBreakdown` has of this grid and no rounding tiebreak is in play.
    {
      entity: "expense",
      entityId: ENTRY.cantina,
      kind: "create",
      patch: {
        description: "Chalmun’s cantina",
        occurredAt: dayBefore(now, 7),
        dateOnly: true,
        createdAt: dayBefore(now, 7),
        ...inCredits(8_100),
        paidBy: ids.Luke,
        payers: { [ids.Luke]: 5_000, [ids.Han]: 3_100 },
        split: { mode: "receipt", weights: billWeights(ids) },
        receiptItems: DEMO_BILL.map(({ label, labelEn, minor, quantity }) => ({
          label,
          labelEn,
          amount: minorToDecimalString(minor, DEMO_CURRENCY),
          ...(quantity ? { quantity } : {}),
        })),
        receiptInvolved: all,
        receiptAssignments: DEMO_BILL.map(({ who }) => who.map((name) => ids[name])),
      },
    },
    // The one in spaceport coin, priced by the registry above: the ledger
    // shows the conversion and /g/rates shows where the number came from.
    {
      entity: "expense",
      entityId: ENTRY.docking,
      kind: "create",
      patch: {
        description: "Docking bay 94",
        occurredAt: dayBefore(now, 6),
        dateOnly: true,
        createdAt: dayBefore(now, 6),
        ...inWup(96_000),
        paidBy: ids.Han,
        split: equal(all),
      },
    },
    // One that leaves two people out: the faded row, nothing to do with you.
    {
      entity: "expense",
      entityId: ENTRY.dejarik,
      kind: "create",
      patch: {
        description: "Dejarik stake",
        occurredAt: dayBefore(now, 5),
        dateOnly: true,
        createdAt: dayBefore(now, 5),
        ...inCredits(3_000),
        paidBy: ids.Han,
        split: equal([ids.Han, ids.Chewie]),
      },
    },
    // An income: same shape as an expense, and the sign is applied once, in
    // `computeBalances` and nowhere else (ADR-0010).
    {
      entity: "expense",
      entityId: ENTRY.speeder,
      kind: "create",
      patch: {
        kind: "income",
        description: "Sold the landspeeder",
        occurredAt: dayBefore(now, 3),
        dateOnly: true,
        createdAt: dayBefore(now, 3),
        ...inCredits(200_000),
        paidBy: ids.Luke,
        split: equal(all),
      },
    },
    // A transfer: it moves a debt, it does not create one.
    {
      entity: "settlement",
      entityId: ENTRY.advance,
      kind: "create",
      patch: {
        fromMember: ids.Luke,
        toMember: ids.Han,
        ...inCredits(200_000),
        occurredAt: dayBefore(now, 2),
        dateOnly: true,
        createdAt: dayBefore(now, 2),
        note: "Two thousand now, at the booth",
        deletedAt: null,
      },
    },

    // One entry written and then taken back, so history is not all creates.
    {
      entity: "expense",
      entityId: ENTRY.greedo,
      kind: "create",
      patch: {
        description: "Greedo’s finder’s fee",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inWup(30_000),
        paidBy: ids.Han,
        split: equal(all),
      },
    },
    {
      entity: "expense",
      entityId: ENTRY.greedo,
      kind: "delete",
      // Empty, like every other delete: the fold stamps `deletedAt` from the
      // op's own clock and ignores what a delete patch carries.
      patch: {},
      note: "Han settled that one at the table",
    },
    // ...and one corrected in two fields, so the diff shows a sentence with a
    // line under it rather than a single number. An entry is written whole
    // (docs/sync.md), which is why the patch carries what did not change too.
    {
      entity: "expense",
      entityId: ENTRY.passage,
      kind: "update",
      patch: {
        description: "Passage to Alderaan, no questions",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inCredits(1_700_000),
        paidBy: ids.Ben,
        split: equal([ids.Ben, ids.Luke]),
      },
    },
  ];
}

/**
 * A fingerprint of the seed this build carries. `openDemo` is idempotent, so on
 * its own it would hand back the group it seeded months ago forever; the caller
 * compares this with the string it stored and re-seeds when they differ. That
 * makes *the seed changing* the trigger, rather than a constant somebody has to
 * remember to bump.
 *
 * Dates are zeroed before hashing, so the stamp answers "is this the same
 * story" and not "is it the same evening" — otherwise every midnight, and every
 * flight across a timezone, would read as a new seed.
 */
export function demoStamp(): string {
  const dated = /^(occurredAt|createdAt|claimedAt|asOf)$/;
  const json = JSON.stringify(
    demoOps(demoCast("stamp"), 0),
    (key, value) => (dated.test(key) ? 0 : value),
  );
  // FNV-1a, in base 36. A fingerprint, not a digest: nothing here is secret,
  // and the only question asked of it is whether two builds agree.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
