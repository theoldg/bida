import { convertMinor, minorToDecimalString } from "./money.js";
import type { OpDraft } from "./invariants.js";
import { colorSeedFor, memberIdFor } from "./names.js";
import type { Id, SplitSpec } from "./types.js";

/**
 * The demo group: ordinary ops that never sync, because the caller skips
 * `saveGroupKey` (docs/sync.md#the-demo-group-has-no-key).
 */

/** A constant, so opening `/demo` twice reopens one group. */
export const DEMO_GROUP_ID = "demodemodemo";

/** The one question anything outside this module may ask. */
export function isDemo(groupId: string | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

export const DEMO_NAMES = ["Luke", "Han", "Chewie", "Ben"] as const;
type DemoName = (typeof DEMO_NAMES)[number];

const DEMO_CURRENCY = "CRD";
const DEMO_FOREIGN = "WUP";
const DEMO_RATE = "0.0625";

/** Derived from the constant group id, so every phone lays the same seed. */
export interface DemoCast {
  ids: Record<DemoName, Id>;
  colorSeeds: Record<DemoName, number>;
}

export function demoCast(): DemoCast {
  const ids = {} as Record<DemoName, Id>;
  const colorSeeds = {} as Record<DemoName, number>;
  for (const name of DEMO_NAMES) {
    ids[name] = memberIdFor(DEMO_GROUP_ID, name);
    colorSeeds[name] = colorSeedFor(DEMO_GROUP_ID, name);
  }
  return { ids, colorSeeds };
}

const DAY = 86_400_000;

function dayBefore(now: number, daysAgo: number): number {
  const d = new Date(now - daysAgo * DAY);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Fixed, so re-seeding writes the same group rather than a second one. */
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
 * **Every line must divide evenly** among its people: the cent tiebreak lives in
 * the web's `receiptBreakdown`, beyond core's check.
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
 * The web's `billAsText` shape, so the box opens on the bill rather than empty.
 */
function demoBillText(): string {
  return DEMO_BILL.map(({ labelEn, minor, quantity }) =>
    [quantity ? String(quantity) : "", labelEn, minorToDecimalString(minor, DEMO_CURRENCY)]
      .filter(Boolean).join(" "),
  ).join("\n");
}

export interface DemoStep {
  by: Id;
  at: number;
  ops: OpDraft[];
}

/**
 * Each step its own author and moment, so history reads as four people over nine
 * days. **Steps are chronological** and fall before `now`'s day (tested). Dates
 * follow the tour: the ledger is newest first, so what a visitor should see first
 * is latest.
 */
export function demoTimeline(cast: DemoCast, now: number): DemoStep[] {
  const { ids } = cast;
  const all = DEMO_NAMES.map((name) => ids[name]);
  const equal = (members: readonly Id[]): SplitSpec => ({ mode: "equal", members: [...members] });
  /** No feed knows WUP. */
  const inWup = (minor: number) => ({
    amountMinor: minor,
    currency: DEMO_FOREIGN,
    rateToBase: DEMO_RATE,
    rateSource: "typed",
    baseAmountMinor: convertMinor(minor, DEMO_FOREIGN, DEMO_CURRENCY, DEMO_RATE),
  });
  const inCredits = (minor: number) => ({
    amountMinor: minor,
    currency: DEMO_CURRENCY,
    rateToBase: "1",
    baseAmountMinor: minor,
  });
  /** Before 23:00, so a DST day can't push it into the next. */
  const at = (daysAgo: number, hour: number, minute = 0) =>
    dayBefore(now, daysAgo) + (hour * 60 + minute) * 60_000;
  const step = (by: DemoName, when: number, ...ops: OpDraft[]): DemoStep =>
    ({ by: ids[by], at: when, ops });

  const passage = {
    occurredAt: dayBefore(now, 2),
    dateOnly: true,
    createdAt: dayBefore(now, 2),
    paidBy: ids.Ben,
    split: equal([ids.Ben, ids.Luke]),
  };

  return [
    step("Luke", at(9, 10, 12),
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
      // No identity: the claim gate asks the visitor which of the four they are.
    ),
    step("Han", at(8, 18, 5), {
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
    }),
    step("Han", at(6, 14, 22), {
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
    }),
    step("Chewie", at(5, 22, 47), {
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
    }),
    step("Luke", at(4, 11, 30), {
      entity: "expense",
      entityId: ENTRY.speeder,
      kind: "create",
      patch: {
        kind: "income",
        description: "Sold the landspeeder",
        occurredAt: dayBefore(now, 4),
        dateOnly: true,
        createdAt: dayBefore(now, 4),
        ...inCredits(200_000),
        paidBy: ids.Luke,
        split: equal(all),
      },
    }),
    step("Luke", at(3, 16, 8), {
      entity: "settlement",
      entityId: ENTRY.advance,
      kind: "create",
      patch: {
        fromMember: ids.Luke,
        toMember: ids.Han,
        ...inCredits(200_000),
        occurredAt: dayBefore(now, 3),
        dateOnly: true,
        createdAt: dayBefore(now, 3),
        note: "Two thousand now, at the booth",
        deletedAt: null,
      },
    }),
    step("Ben", at(2, 19, 51), {
      entity: "expense",
      entityId: ENTRY.passage,
      kind: "create",
      patch: { description: "Passage to Alderaan", ...inCredits(1_500_000), ...passage },
    }),
    // An entry is written whole, so the patch carries unchanged fields too.
    step("Ben", at(1, 8, 15), {
      entity: "expense",
      entityId: ENTRY.passage,
      kind: "update",
      patch: { description: "Passage to Alderaan, no questions", ...inCredits(1_700_000), ...passage },
    }),
    step("Luke", at(1, 21, 36), {
      entity: "expense",
      entityId: ENTRY.cantina,
      kind: "create",
      patch: {
        description: "Chalmun’s cantina",
        occurredAt: dayBefore(now, 1),
        dateOnly: true,
        createdAt: dayBefore(now, 1),
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
        receiptText: demoBillText(),
        receiptEnglish: true,
      },
    }),
    step("Luke", at(1, 22, 3), {
      entity: "expense",
      entityId: ENTRY.greedo,
      kind: "delete",
      // The fold stamps `deletedAt` from the op's `createdAt`.
      patch: {},
      note: "Han settled that one at the table",
    }),
  ];
}

export function demoOps(cast: DemoCast, now: number): OpDraft[] {
  return demoTimeline(cast, now).flatMap((s) => s.ops);
}

/**
 * Dates are zeroed first, so a new day or timezone doesn't read as a new seed.
 */
export function demoStamp(): string {
  const dated = /^(occurredAt|createdAt|at)$/;
  // The timeline, not the ops: who wrote what is part of the story too.
  const json = JSON.stringify(
    demoTimeline(demoCast(), 0),
    (key, value) => (dated.test(key) ? 0 : value),
  );
  // A fingerprint, not a digest: nothing here is secret.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
