import { convertMinor, minorToDecimalString } from "./money.js";
import type { OpDraft } from "./invariants.js";
import { colorSeedFor, memberIdFor } from "./names.js";
import type { Id, SplitSpec } from "./types.js";

/**
 * The demo group: ordinary ops that never sync. Nothing downstream knows it's
 * a demo — the caller just skips `saveGroupKey`, so `runSyncAll` never sees it
 * (docs/sync.md#the-demo-group-has-no-key). Dates are offsets from `now`.
 */

/**
 * A constant, so opening `/demo` twice reopens one group. Shaped like
 * `newGroupId()`; readable on purpose, as a keyless group never reaches the server.
 */
export const DEMO_GROUP_ID = "demodemodemo";

/** Is this the demo? The one question anything outside this module may ask. */
export function isDemo(groupId: string | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

/** The device is Luke, or the personal lens is blank. */
export const DEMO_NAMES = ["Luke", "Han", "Chewie", "Ben"] as const;
type DemoName = (typeof DEMO_NAMES)[number];

/** The member the device speaks for: the demo is a group you are already in. */
export const DEMO_ME: DemoName = "Luke";

/** Credits, and the local coin the spaceport actually takes. */
const DEMO_CURRENCY = "CRD";
const DEMO_FOREIGN = "WUP";
/** Sixteen wupiupi to the credit. */
const DEMO_RATE = "0.0625";

/**
 * Only the device's node id comes from the caller; member ids and hues derive
 * from the constant group id, which lets `demoStamp` fingerprint the seed.
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
 * The cantina bill: one table read as printed lines, grid and split weights.
 * In the local tongue with English beside it, so the demo shows translation.
 * **Every line must divide evenly** among its people: the cent tiebreak lives
 * in the web's `receiptBreakdown`, beyond core's check.
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
 * The whole evening as drafts, deterministic in `cast` and `now`. Chosen so
 * every screen has something: two payers with an itemised bill, local coin, a
 * partial split, an income, a transfer, an edit and a delete. Balances don't
 * cancel, so settle-up has transfers to propose.
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
    // Without a claim the personal lens is blank and the claim gate blocks the demo.
    {
      entity: "identity",
      entityId: cast.deviceNodeId,
      kind: "create",
      patch: { memberId: ids[DEMO_ME], claimedAt: dayBefore(now, 9) },
    },
    // One rate row, so /g/rates has something and editing it moves every WUP entry.
    {
      entity: "rate",
      entityId: DEMO_FOREIGN,
      kind: "create",
      patch: {
        rate: DEMO_RATE, source: "typed", asOf: dayBefore(now, 8), deletedAt: null,
      },
    },

    // Fronted by somebody else, leaving Han and Chewie (being paid) out.
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
    // Two payers (`paidBy` is the larger) and itemised, so each person's split is
    // what they ordered (ADR-0016).
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
    // Priced by the registry above.
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
    // Same shape as an expense; the sign is applied only in `computeBalances`.
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

    // So history is not all creates.
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
      // The fold stamps `deletedAt` from the op's clock and ignores the patch.
      patch: {},
      note: "Han settled that one at the table",
    },
    // Edited in two fields, so the diff shows more than one number. An entry is
    // written whole (docs/sync.md), so the patch carries unchanged fields too.
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
 * A fingerprint of this build's seed. `openDemo` is idempotent, so the caller
 * re-seeds when this differs from the stored one. Dates are zeroed first, so a
 * new day or timezone doesn't read as a new seed.
 */
export function demoStamp(): string {
  const dated = /^(occurredAt|createdAt|claimedAt|asOf)$/;
  const json = JSON.stringify(
    demoOps(demoCast("stamp"), 0),
    (key, value) => (dated.test(key) ? 0 : value),
  );
  // FNV-1a, base 36. A fingerprint, not a digest: nothing here is secret.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
