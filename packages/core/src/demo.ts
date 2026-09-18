import { convertMinor } from "./money.js";
import type { OpDraft } from "./invariants.js";
import type { Id, SplitSpec } from "./types.js";

/**
 * The demo group: a real group, made of real ops, that never syncs.
 *
 * Nothing downstream knows it is a demo. These are ordinary drafts, appended
 * by `appendOps` like any other command and folded by `foldOps` like any other
 * log, so the ledger, the balances, settle-up, the history diffs, the rate
 * registry and the export all work for the ordinary reason: none of them is
 * asked. What makes it a demo is what the *caller* leaves out — no
 * `saveGroupKey`, so no key row, so `runSyncAll` never sees it and
 * `syncGroupOnce` returns early. There is no flag to flip and no path to
 * disable (docs/sync.md#the-demo-group-has-no-key).
 *
 * The cast is Marrakech with Teo, Marie, Sam and Ada — the same trip
 * `scripts/shots.mjs` seeds through the UI and the same one
 * `fixtures.test-helper.ts` pins, so the project has one fixture story rather
 * than three. Dates are offsets from `now`, so it never reads stale.
 */

/**
 * The demo's group id. A constant, so `/demo` is idempotent for free: opening
 * it twice reopens the one group instead of stacking copies.
 *
 * Shaped like `newGroupId()`'s 12 base36 characters so it is one kind of thing
 * everywhere ids are stored and compared, and readable on purpose — it is
 * never a secret, because a group with no key is a group the server cannot be
 * told about. Two phones minting it at once is meaningless for the same
 * reason: nothing syncs, so there is nothing to collide over.
 */
export const DEMO_GROUP_ID = "demodemodemo";

/** Is this the demo? The one question anything outside this module may ask. */
export function isDemo(groupId: string | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

/** The four people on the trip. The device is Teo, or the personal lens is blank. */
export const DEMO_NAMES = ["Teo", "Marie", "Sam", "Ada"] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

/** The member the device speaks for: the demo is a group you are already in. */
export const DEMO_ME: DemoName = "Teo";

export const DEMO_CURRENCY = "EUR";
/** The trip's other currency, and the one rate the registry carries. */
export const DEMO_FOREIGN = "MAD";
export const DEMO_RATE = "0.0921";

/**
 * What the caller mints and core cannot: member ids and avatar hues come from
 * `memberIdFor`/`colorSeedFor`, which are the app's, and the node id is the
 * device's own. Core stays pure and is handed all three.
 */
export interface DemoCast {
  /** Member id per name, from `memberIdFor(DEMO_GROUP_ID, name)`. */
  ids: Record<DemoName, Id>;
  /** Avatar hue per name, from `colorSeedFor(DEMO_GROUP_ID, name)`. */
  colorSeeds: Record<DemoName, number>;
  /** The device's HLC node id, so the identity claim is this phone's own. */
  deviceNodeId: Id;
}

const DAY = 86_400_000;

/** Local midnight `daysAgo` days back: an entry carries a day, not an hour. */
function dayBefore(now: number, daysAgo: number): number {
  const d = new Date(now - daysAgo * DAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Entity ids are fixed, so re-seeding writes the same group rather than a second one. */
const ENTRY = {
  riad: "demo-riad",
  dinner: "demo-dinner",
  cafe: "demo-cafe",
  sunglasses: "demo-sunglasses",
  deposit: "demo-deposit",
  taxi: "demo-taxi",
  payback: "demo-payback",
} as const;

/**
 * The whole trip, as one batch of drafts.
 *
 * Deterministic in `cast` and `now`: the same arguments write a byte-identical
 * log, which is what makes *reset* and *clear, then reopen* the same call
 * twice. Pure, and the clock is an argument (CLAUDE.md).
 *
 * The contents are chosen so every screen has something to say: a plain
 * expense, one with two payers, one in MAD priced by a group rate, one that
 * leaves two people out, an income, a transfer, one entry edited in two fields
 * and one deleted. The balances deliberately do not cancel, so settle-up
 * proposes transfers rather than "all square".
 */
export function demoOps(cast: DemoCast, now: number): OpDraft[] {
  const { ids } = cast;
  const all = DEMO_NAMES.map((name) => ids[name]);
  const equal = (members: readonly Id[]): SplitSpec => ({ mode: "equal", members: [...members] });
  /** An amount in the trip's own currency, as the registry prices it today. */
  const inMad = (minor: number) => ({
    amountMinor: minor,
    currency: DEMO_FOREIGN,
    rateToBase: DEMO_RATE,
    baseAmountMinor: convertMinor(minor, DEMO_FOREIGN, DEMO_CURRENCY, DEMO_RATE),
  });
  const inEur = (minor: number) => ({
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
        name: "Marrakech",
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
    // This phone is Teo. Without it the ledger's personal lens has nothing to
    // be personal about, and the claim gate would stop the demo at the door.
    {
      entity: "identity",
      entityId: cast.deviceNodeId,
      kind: "create",
      patch: { memberId: ids[DEMO_ME], claimedAt: dayBefore(now, 9) },
    },
    // The group's rate registry: what a dirham is worth, for everybody, now.
    // One row, so /g/rates has something to show and correcting it moves every
    // MAD entry in the ledger (ADR-0005).
    {
      entity: "rate",
      entityId: DEMO_FOREIGN,
      kind: "create",
      patch: {
        rate: DEMO_RATE, source: "typed", asOf: dayBefore(now, 8), deletedAt: null,
      },
    },

    // A plain expense, somebody else paid: the row the personal lens colours red.
    {
      entity: "expense",
      entityId: ENTRY.riad,
      kind: "create",
      patch: {
        description: "Riad Jnane",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inEur(58_000),
        paidBy: ids.Marie,
        split: equal(all),
      },
    },
    // Two payers on one dinner: `paidBy` is the larger of them (core/payers.ts).
    {
      entity: "expense",
      entityId: ENTRY.dinner,
      kind: "create",
      patch: {
        description: "Dinner at Nomad",
        occurredAt: dayBefore(now, 7),
        dateOnly: true,
        createdAt: dayBefore(now, 7),
        ...inEur(9_200),
        paidBy: ids.Teo,
        payers: { [ids.Teo]: 6_000, [ids.Sam]: 3_200 },
        split: equal(all),
      },
    },
    // The one in dirhams, priced by the registry above: the ledger shows the
    // conversion and /g/rates shows where the number came from.
    {
      entity: "expense",
      entityId: ENTRY.cafe,
      kind: "create",
      patch: {
        description: "Café Clock",
        occurredAt: dayBefore(now, 6),
        dateOnly: true,
        createdAt: dayBefore(now, 6),
        ...inMad(62_000),
        paidBy: ids.Sam,
        split: equal(all),
      },
    },
    // One that leaves two people out: the faded row, nothing to do with you.
    {
      entity: "expense",
      entityId: ENTRY.sunglasses,
      kind: "create",
      patch: {
        description: "Marie’s sunglasses",
        occurredAt: dayBefore(now, 5),
        dateOnly: true,
        createdAt: dayBefore(now, 5),
        ...inEur(4_500),
        paidBy: ids.Marie,
        split: equal([ids.Marie, ids.Ada]),
      },
    },
    // An income: same shape as an expense, and the sign is applied once, in
    // `computeBalances` and nowhere else (ADR-0010).
    {
      entity: "expense",
      entityId: ENTRY.deposit,
      kind: "create",
      patch: {
        kind: "income",
        description: "Riad deposit back",
        occurredAt: dayBefore(now, 3),
        dateOnly: true,
        createdAt: dayBefore(now, 3),
        ...inEur(15_000),
        paidBy: ids.Marie,
        split: equal(all),
      },
    },
    // A transfer: it moves a debt, it does not create one.
    {
      entity: "settlement",
      entityId: ENTRY.payback,
      kind: "create",
      patch: {
        fromMember: ids.Sam,
        toMember: ids.Teo,
        ...inEur(4_000),
        occurredAt: dayBefore(now, 2),
        dateOnly: true,
        createdAt: dayBefore(now, 2),
        note: "Airport taxi",
        deletedAt: null,
      },
    },

    // One entry written and then taken back, so history is not all creates.
    {
      entity: "expense",
      entityId: ENTRY.taxi,
      kind: "create",
      patch: {
        description: "Grand taxi from RAK",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inMad(30_000),
        paidBy: ids.Ada,
        split: equal(all),
      },
    },
    {
      entity: "expense",
      entityId: ENTRY.taxi,
      kind: "delete",
      // Empty, like every other delete: the fold stamps `deletedAt` from the
      // op's own clock and ignores what a delete patch carries.
      patch: {},
      note: "Ada was paid back in cash",
    },
    // ...and one corrected in two fields, so the diff shows a sentence with a
    // line under it rather than a single number. An entry is written whole
    // (docs/sync.md), which is why the patch carries what did not change too.
    {
      entity: "expense",
      entityId: ENTRY.riad,
      kind: "update",
      patch: {
        description: "Riad Jnane, four nights",
        occurredAt: dayBefore(now, 8),
        dateOnly: true,
        createdAt: dayBefore(now, 8),
        ...inEur(61_000),
        paidBy: ids.Marie,
        split: equal(all),
      },
      note: "The fourth night was on the same bill",
    },
  ];
}
