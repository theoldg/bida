import type { CurrencyCode } from "./money.js";
import type { EntityKind, OpKind } from "./ops.js";
import { memberInvolved } from "./payers.js";
import { currenciesInUse } from "./rates.js";
import {
  alive, type ExchangeRate, type GroupState, type Id, type Member,
} from "./types.js";

/**
 * The invariants a merge can break, and the repair that folds each one away.
 *
 * The op log guarantees convergence, not validity: an invariant spanning two
 * entities is checked in the UI against one device's snapshot, which is a wish
 * and not a guard ([docs/invariants.md](../../../docs/invariants.md)). So
 * `repair` is required and the refusal `wouldViolate` is optional — you cannot
 * register a refusal without saying how the state it fails to prevent heals.
 *
 * A healer must be: a pure detector named for the *state* (not the race that
 * produced it); ordinary ops, nothing the fold must learn; idempotent, so a
 * second device writes nothing; deterministic, so two writing at once agree;
 * and its history note names the cause, not an actor. `invariants.test.ts`
 * holds every entry to all five and demands a fixture that violates it.
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
 * One invariant, its detector and its repair. `V` is whatever the detector
 * names — a member, a rate row — and all `repair` is handed, so a repair
 * cannot quietly consult state the detector never looked at.
 */
interface Invariant<V> {
  /** Stable identifier. Appears in test failures and in the healer's history note. */
  readonly name: string;
  /** The state this describes, in the words of the table in docs/invariants.md. */
  readonly holds: string;
  /** Everything currently violating it. Pure, total, deterministic. */
  detect(state: GroupState): V[];
  /** Ops that fold the violation away. Required; see the note at the top. */
  repair(violations: readonly V[]): OpDraft[];
  /**
   * Would appending this draft break the invariant, as far as *this* device
   * can see? A courtesy refusal, never correctness: one replica's snapshot
   * cannot constrain the union of two.
   */
  wouldViolate?(state: GroupState, draft: OpDraft): boolean;
}

/** A declared invariant: guard filled in, violation type intact. */
interface Declared<V> extends Invariant<V> {
  wouldViolate(state: GroupState, draft: OpDraft): boolean;
}

/**
 * `V` erased, so one array can hold all of them. Safe because the registry
 * only ever hands a detector's own output back to its own repair.
 */
export type RegisteredInvariant = Declared<unknown>;

/** Type-check an invariant against its own violation type, and fill in its guard. */
function defineInvariant<V>(spec: Invariant<V>): Declared<V> {
  return {
    ...spec,
    // No guard means "nothing to refuse", never "refuse by default".
    wouldViolate: (state, draft) => spec.wouldViolate?.(state, draft) ?? false,
  };
}

/**
 * A live entry names only live members. Reaching this takes two phones — one
 * removes Bruno, the other, offline, writes a transfer to him. The tombstone
 * gives way: an entry is money somebody typed, a removal is only the claim
 * that nobody was naming them.
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
 * A currency a live entry is written in has a live rate — the mirror of the
 * member case, failing the same way. The repair is the lift `setRate` already
 * writes (rates.ts); a rate op's entity id is the currency code, so it lands
 * on the tombstoned row.
 *
 * A currency with **no row at all** is deliberately not detected: there is no
 * number to restore, and `needsRate` and the rate dialog already own it.
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
 * Every invariant the app repairs. Order is not significant and must not become
 * so: healers that fight — one tombstoning what another lifts — are an op loop
 * that syncs. `healGroup` runs to a fixed point; the property test proves one
 * exists for each entry.
 */
export const INVARIANTS: readonly RegisteredInvariant[] = [
  liveEntriesNameLiveMembers,
  liveEntriesHaveLiveRates,
];

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
 * Would this draft break something, on the evidence this device holds? The
 * single source for every refusal in the UI — a screen asking its own version
 * lets the guard and the healer drift
 * ([docs/invariants.md](../../../docs/invariants.md)).
 */
export function wouldViolate(state: GroupState, draft: OpDraft): RegisteredInvariant | undefined {
  return INVARIANTS.find((i) => i.wouldViolate(state, draft));
}

/**
 * The op that puts this device's own member back, when a merge removed them.
 *
 * Cannot be in `INVARIANTS`: a registered detector sees only `GroupState`, and
 * the premise here is device-local — *which* member this phone is. Registered,
 * every device would resurrect every claimed member and no removal would ever
 * stick. Device-local, only the person removed argues back, and **forgetting
 * the group ends it**: a forgotten group is skipped by the sync loop
 * (docs/invariants.md).
 */
export function restoreClaimDrafts(state: GroupState, memberId: Id): OpDraft[] {
  const member = state.members[memberId];
  if (!member?.deletedAt) return [];
  return [{ entity: "member", entityId: memberId, kind: "update", patch: { deletedAt: null } }];
}
