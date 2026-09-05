import type { CurrencyCode } from "./money.js";
import type { EntityKind, Op, OpKind } from "./ops.js";
import { memberInvolved } from "./payers.js";
import { currenciesInUse } from "./rates.js";
import {
  alive, type ExchangeRate, type GroupState, type Id, type Member,
} from "./types.js";

/**
 * The invariants a merge can break, and the repair that folds each one away.
 *
 * ## Why this file exists
 *
 * The op log guarantees convergence — every device folds to the same state. It
 * does not guarantee validity: that the agreed state is one the app considers
 * legal. The two come apart wherever an invariant spans more than one entity,
 * because those get checked in the UI, at write time, against a single device's
 * snapshot. A precondition that quantifies over entities you did not write is
 * not a guard, it is a wish ([docs/invariants.md](../../../docs/invariants.md)).
 *
 * Every defect of this class found so far was a **guard whose healer was never
 * written**: the check looked like enforcement, so nobody asked what happened
 * when it lost. `repair` is therefore required, and `wouldViolate` — the UI's
 * refusal — is optional and derived from the same declaration. You cannot
 * register a refusal here without saying how the state it fails to prevent gets
 * repaired, which is the one thing that would have caught both bugs.
 *
 * ## What a healer must be
 *
 * 1. **Detection is a pure function on state**, named for the *state* — whichever
 *    race produced it gets the same repair.
 * 2. **The repair is ordinary ops.** No new op kind, nothing the fold must learn.
 * 3. **Idempotent**: the healed state fails its own detector, so a second run,
 *    screen or device writes nothing.
 * 4. **Deterministic**, so two phones noticing at once write the same repair.
 * 5. **History names the cause, not the actor** — money moved with nobody asking.
 *
 * `invariants.test.ts` holds every one of those to each entry in the registry,
 * and refuses to let a new entry be added without a fixture that violates it.
 */

/** An op with everything the appender stamps — id, hlc, actor, clock — left off. */
export interface OpDraft {
  entity: EntityKind;
  entityId: Id;
  kind: OpKind;
  patch: Record<string, unknown>;
  note?: string | null;
}

/**
 * One invariant, its detector and its repair.
 *
 * `V` is whatever the detector names — a member, a rate row — and is the only
 * thing `repair` is handed, so a repair cannot quietly consult state the
 * detector never looked at.
 */
export interface Invariant<V> {
  /** Stable identifier. Appears in test failures and in the healer's history note. */
  readonly name: string;
  /** The state this describes, in the words of the table in docs/invariants.md. */
  readonly holds: string;
  /** Everything currently violating it. Pure, total, deterministic. */
  detect(state: GroupState): V[];
  /**
   * Ops that fold the violation away. Required — an invariant with no repair is
   * the exact shape of every defect this file exists to prevent.
   */
  repair(violations: readonly V[]): OpDraft[];
  /**
   * Would appending this draft break the invariant, as far as *this* device can
   * see? The UI's courtesy refusal, and never a correctness mechanism: it reads
   * one replica's snapshot and cannot constrain the union of two.
   */
  wouldViolate?(state: GroupState, draft: OpDraft): boolean;
}

/**
 * A declared invariant: its optional guard filled in, its violation type intact.
 * Naming one directly — a test, a screen that needs its detector — keeps `V`.
 */
export interface Declared<V> extends Invariant<V> {
  wouldViolate(state: GroupState, draft: OpDraft): boolean;
}

/**
 * The same thing with `V` erased, which is what lets one array hold all of
 * them. Assignable from any `Declared<V>`: the registry only ever hands a
 * detector's own output back to its own repair.
 */
export type RegisteredInvariant = Declared<unknown>;

/** Type-check an invariant against its own violation type, and fill in its guard. */
export function defineInvariant<V>(spec: Invariant<V>): Declared<V> {
  return {
    ...spec,
    // A guard is optional; its absence means "nothing to refuse", never
    // "refuse by default" — a refusal that isn't declared here is one the UI
    // must not invent.
    wouldViolate: (state, draft) => spec.wouldViolate?.(state, draft) ?? false,
  };
}

/**
 * A live entry names only live members.
 *
 * Removal is refused while anybody is named on a live entry, so reaching this
 * takes two phones — one removes Bruno, the other, offline, writes a transfer
 * to him — and it appears where they merge. The tombstone is the half the log
 * has since contradicted: an entry is money somebody typed, a removal is only
 * the claim that nobody was naming them. So the tombstone gives way.
 */
export const liveEntriesNameLiveMembers = defineInvariant<Member>({
  name: "liveEntriesNameLiveMembers",
  holds: "A live entry names only live members",
  detect(state) {
    const entries = { expenses: alive(state.expenses), settlements: alive(state.settlements) };
    return Object.values(state.members)
      .filter((m) => !!m.deletedAt && memberInvolved(entries, m.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  },
  repair(members) {
    return members.map((m) => ({
      entity: "member" as const,
      entityId: m.id,
      kind: "update" as const,
      patch: { deletedAt: null },
    }));
  },
  wouldViolate(state, draft) {
    if (draft.entity !== "member" || draft.kind !== "delete") return false;
    return memberInvolved(
      { expenses: alive(state.expenses), settlements: alive(state.settlements) },
      draft.entityId,
    );
  },
});

/**
 * A currency a live entry is written in has a live rate.
 *
 * The mirror of the member case, and it fails the same way: clearing a rate is
 * refused while entries still spend in it, which needs both facts on one phone.
 * The repair is the lift `setRate` already writes (rates.ts) — a rate op's
 * entity id is the currency code, so it lands on the tombstoned row.
 *
 * A currency with **no row at all** is a different state and is deliberately
 * not detected: the group has never said what it is worth, there is no number
 * to restore, and `needsRate` and the rate dialog already own it.
 */
export const liveEntriesHaveLiveRates = defineInvariant<ExchangeRate>({
  name: "liveEntriesHaveLiveRates",
  holds: "A currency with live entries has a live rate",
  detect(state) {
    return currenciesInUse(state)
      .filter((c) => c.entryCount > 0 && c.rate === undefined)
      .map((c) => state.rates[c.currency])
      // `rate: undefined` also covers a currency with no row and one whose
      // rate string is unparseable. Only a tombstone is a state a lift repairs.
      .filter((row): row is ExchangeRate => !!row && !!row.deletedAt)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  },
  repair(rates) {
    return rates.map((r) => ({
      entity: "rate" as const,
      entityId: r.id,
      kind: "update" as const,
      patch: { deletedAt: null },
    }));
  },
  wouldViolate(state, draft) {
    if (draft.entity !== "rate" || draft.kind !== "delete") return false;
    const currency = draft.entityId as CurrencyCode;
    return currenciesInUse(state).some((c) => c.currency === currency && c.entryCount > 0);
  },
});

/**
 * Every invariant the app repairs, in the order they run.
 *
 * Order is not significant today and must not become so: healers that fight —
 * one tombstoning what another lifts — are an op loop that syncs. `healGroup`
 * runs to a fixed point and the property test proves each entry reaches one.
 */
export const INVARIANTS: readonly RegisteredInvariant[] = [
  liveEntriesNameLiveMembers,
  liveEntriesHaveLiveRates,
];

/** Every violation in the state, by invariant name. Empty when the state is legal. */
export function detectAll(state: GroupState): Record<string, unknown[]> {
  const found: Record<string, unknown[]> = {};
  for (const invariant of INVARIANTS) {
    const violations = invariant.detect(state);
    if (violations.length > 0) found[invariant.name] = violations;
  }
  return found;
}

/**
 * The ops that would make this state legal. Empty when it already is, which is
 * what makes running this on every merge cost nothing.
 */
export function healDrafts(state: GroupState): OpDraft[] {
  const drafts: OpDraft[] = [];
  for (const invariant of INVARIANTS) {
    const violations = invariant.detect(state);
    if (violations.length > 0) drafts.push(...invariant.repair(violations));
  }
  return drafts;
}

/**
 * Would this draft break something, on the evidence this device holds?
 *
 * The single source for every refusal in the UI. A screen that asks its own
 * version of this question is the bug in [docs/invariants.md](../../../docs/invariants.md):
 * the guard and the healer drift, and the guard is the half that looks like
 * enforcement.
 */
export function wouldViolate(state: GroupState, draft: OpDraft): RegisteredInvariant | undefined {
  return INVARIANTS.find((i) => i.wouldViolate(state, draft));
}

/**
 * The op that puts this device's own member back, when a merge removed them.
 *
 * Not in `INVARIANTS`, and it cannot be: a registered detector sees only
 * `GroupState`, and the premise here is device-local — *which* member this
 * phone is. Registered, every device would resurrect every claimed member, and
 * a removal would be unrefusable by anyone. Kept device-local, the person being
 * removed is the only one who puts themselves back, and **forgetting the group
 * is the exit that ends it**: a forgotten group is skipped by the sync loop, so
 * the phone stops arguing (docs/invariants.md).
 *
 * A removal the other side goes on refusing was never a removal — it is two
 * people disagreeing, and a shared ledger is not where that gets settled.
 */
export function restoreClaimDrafts(state: GroupState, memberId: Id): OpDraft[] {
  const member = state.members[memberId];
  if (!member?.deletedAt) return [];
  return [{ entity: "member", entityId: memberId, kind: "update", patch: { deletedAt: null } }];
}

export type { Op };
