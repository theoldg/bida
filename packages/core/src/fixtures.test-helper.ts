import { convertMinor } from "./money.js";
import { createHlcState, hlcSend, type HlcState } from "./hlc.js";
import type { Op } from "./ops.js";
import type { SplitSpec } from "./types.js";

/**
 * The Marrakech trip — the pinned fixture, as ops.
 *
 * Its numbers are quoted in docs/testing.md; if the arithmetic
 * here changes, that doc is wrong and must be updated to match.
 */

export const GROUP = "g-marrakech";
export const MAD_RATE = "0.0921";

/** Ids are deliberately alphabetical: ada < marie < sam < theo. Remainder
 *  tiebreaks depend on that ordering, so the fixture pins it. */
export const ADA = "ada";
export const MARIE = "marie";
export const SAM = "sam";
export const THEO = "theo";
export const ALL = [ADA, MARIE, SAM, THEO];

export class OpBuilder {
  private state: HlcState;
  private clock: number;
  readonly ops: Op[] = [];
  private n = 0;

  constructor(node = "fixture", startAt = 1_743_600_000_000) {
    this.state = createHlcState(node);
    this.clock = startAt;
  }

  push(
    entity: Op["entity"],
    entityId: string,
    kind: Op["kind"],
    patch: Record<string, unknown>,
    actor = THEO,
    note?: string,
  ): Op {
    this.clock += 1000;
    const { state, hlc } = hlcSend(this.state, this.clock);
    this.state = state;
    const op: Op = {
      id: `op-${String(++this.n).padStart(3, "0")}`,
      groupId: GROUP,
      entity,
      entityId,
      kind,
      patch,
      hlc,
      actor,
      note: note ?? null,
      createdAt: this.clock,
      seq: null,
    };
    this.ops.push(op);
    return op;
  }
}

export interface ExpenseSeed {
  id: string;
  description: string;
  mad?: number;      // amount in MAD major units
  eur?: number;      // amount already in EUR major units
  paidBy: string;
  members: string[];
  day: number;
}

export const EXPENSES: ExpenseSeed[] = [
  { id: "e-riad",      description: "Riad Jnane · 4 nights",      eur: 580,  paidBy: MARIE, members: ALL,                day: 3 },
  { id: "e-nomad",     description: "Dinner · Nomad",             mad: 620,  paidBy: THEO,  members: ALL,                day: 3 },
  { id: "e-taxi",      description: "Grand taxi from RAK",        mad: 300,  paidBy: SAM,   members: ALL,                day: 3 },
  { id: "e-majorelle", description: "Jardin Majorelle tickets",   mad: 480,  paidBy: ADA,   members: ALL,                day: 4 },
  { id: "e-souk",      description: "Souk haul · lamp + rug",     mad: 1850, paidBy: MARIE, members: [MARIE, ADA],       day: 4 },
  { id: "e-hammam",    description: "Hammam",                     mad: 700,  paidBy: SAM,   members: [SAM, ADA, MARIE],  day: 5 },
  { id: "e-breakfast", description: "Breakfast · Café des Épices", mad: 210, paidBy: THEO,  members: ALL,                day: 5 },
];

export function marrakechOps(): Op[] {
  const b = new OpBuilder();
  b.push("group", GROUP, "create", {
    name: "Marrakech", baseCurrency: "EUR", createdAt: 1_743_600_000_000,
  }, THEO);
  for (const [i, id] of ALL.entries()) {
    b.push("member", id, "create", { name: id, colorSeed: i * 60 }, THEO);
  }
  for (const e of EXPENSES) {
    const currency = e.mad !== undefined ? "MAD" : "EUR";
    const amountMinor = e.mad !== undefined ? e.mad * 100 : e.eur! * 100;
    const rateToBase = e.mad !== undefined ? MAD_RATE : "1";
    const baseAmountMinor = convertMinor(amountMinor, currency, "EUR", rateToBase);
    const split: SplitSpec = { mode: "equal", members: e.members };
    b.push("expense", e.id, "create", {
      description: e.description,
      occurredAt: Date.UTC(2026, 3, e.day),
      amountMinor, currency, rateToBase, baseAmountMinor,
      paidBy: e.paidBy, split, attachmentIds: [],
    }, e.paidBy);
  }
  return b.ops;
}
