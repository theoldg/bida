import type { CurrencyCode } from "./money.js";
import type { EntityKind, OpKind } from "./ops.js";
import { memberInvolved } from "./payers.js";
import { currenciesInUse } from "./rates.js";
import {
  alive, type ExchangeRate, type GroupState, type Id, type Member,
} from "./types.js";

/**
 * The invariants a merge can break, and the repair that folds each away.
 *
 * The op log guarantees convergence, not validity: a cross-entity check in the
 * UI sees one device's snapshot ([docs/invariants.md](../../../docs/invariants.md)).
 * So `repair` is required and `wouldViolate` optional.
 *
 * A healer must: detect a *state*, not a race; write ordinary ops; be
 * idempotent and deterministic, so concurrent devices agree; and name the
 * cause, not an actor, in its note. `invariants.test.ts` enforces all five.
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
 * One invariant. `repair` is handed only the detector's output, so it can't
 * consult state the detector never looked at.
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
  /** A courtesy refusal from this device's snapshot — never correctness. */
  wouldViolate?(state: GroupState, draft: OpDraft): boolean;
}

/** A declared invariant: guard filled in, violation type intact. */
interface Declared<V> extends Invariant<V> {
  wouldViolate(state: GroupState, draft: OpDraft): boolean;
}

/** `V` erased; safe because each detector's output only reaches its own repair. */
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
 * A live entry names only live members (one phone removes Bruno while another,
 * offline, pays him). The tombstone gives way: an entry is money somebody typed.
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
 * A currency a live entry uses has a live rate. The repair is `setRate`'s lift;
 * rate ops are keyed by currency, so it lands on the tombstoned row. A currency
 * with no row at all is left to `needsRate` and the rate dialog.
 */
export const liveEntriesHaveLiveRates = defineInvariant<ExchangeRate>({
  name: "liveEntriesHaveLiveRates",
  holds: "A currency with live entries has a live rate",
  detect(state) {
    return currenciesInUse(state)
      .filter((c) => c.entryCount > 0 && c.rate === undefined)
      .map((c) => state.rates[c.currency])
      // Only a tombstone is something a lift repairs.
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
 * Every invariant the app repairs. Order must not matter: healers that fight
 * are an op loop that syncs. The property test proves a fixed point exists.
 */
export const INVARIANTS: readonly RegisteredInvariant[] = [
  liveEntriesNameLiveMembers,
  liveEntriesHaveLiveRates,
];

/** The ops that would make this state legal; empty when it is, so it's free on every merge. */
export function healDrafts(state: GroupState): OpDraft[] {
  const drafts: OpDraft[] = [];
  for (const invariant of INVARIANTS) {
    const violations = invariant.detect(state);
    if (violations.length > 0) drafts.push(...invariant.repair(violations));
  }
  return drafts;
}

/**
 * Would this draft break something, on this device's evidence? The single
 * source for UI refusals, so guard and healer can't drift.
 */
export function wouldViolate(state: GroupState, draft: OpDraft): RegisteredInvariant | undefined {
  return INVARIANTS.find((i) => i.wouldViolate(state, draft));
}

/**
 * The op restoring this device's own member after a merge removed them. Not in
 * `INVARIANTS`: registered, every device would resurrect every claimed member
 * and no removal would stick. Forgetting the group ends it (docs/invariants.md).
 */
export function restoreClaimDrafts(state: GroupState, memberId: Id): OpDraft[] {
  const member = state.members[memberId];
  if (!member?.deletedAt) return [];
  return [{ entity: "member", entityId: memberId, kind: "update", patch: { deletedAt: null } }];
}
