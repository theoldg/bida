import { convertMinor, type CurrencyCode, type Rate } from "./money.js";
import type { EntityKind, OpKind } from "./ops.js";
import { memberInvolved } from "./payers.js";
import { rateFor } from "./rates.js";
import {
  alive, type Expense, type GroupState, type Id, type Member, type Settlement,
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

/** An entry the registry still values, and which table it is in. */
interface RegistryValued {
  entity: "expense" | "settlement";
  entry: Expense | Settlement;
  /** The registry's rate, which the entry is read at today. */
  rate: Rate;
  base: CurrencyCode;
}

/**
 * A foreign entry carries its own rate. One written while rates were the
 * group's has none, and is read at the registry's; the repair writes that rate
 * onto it, so moving rates onto the entry moves no balance (ADR-0005). Every
 * entry, tombstones included, so a restore brings nothing with it. An old
 * phone's save drops `rateSource` again, and this picks it back up.
 */
export const entriesCarryTheirOwnRate = defineInvariant<RegistryValued>({
  name: "entriesCarryTheirOwnRate",
  holds: "A foreign entry the registry has a rate for carries its own",
  detect(state) {
    const base = state.group?.baseCurrency;
    if (!base) return [];
    const found: RegistryValued[] = [];
    const scan = (entity: RegistryValued["entity"], rows: Record<Id, Expense | Settlement>) => {
      for (const entry of Object.values(rows)) {
        if (entry.currency === base || entry.rateSource) continue;
        const rate = rateFor(state.rates, base, entry.currency);
        if (rate !== undefined) found.push({ entity, entry, rate, base });
      }
    };
    scan("expense", state.expenses);
    scan("settlement", state.settlements);
    return found.sort((a, b) =>
      a.entity !== b.entity ? (a.entity < b.entity ? -1 : 1)
      : a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0);
  },
  repair(found) {
    return found.map(({ entity, entry, rate, base }) => {
      let baseAmountMinor: number | undefined;
      // Out of range leaves the stored figure; it is re-derived on read anyway.
      try { baseAmountMinor = convertMinor(entry.amountMinor, entry.currency, base, rate); } catch { /* kept */ }
      return {
        entity,
        entityId: entry.id,
        kind: "update" as const,
        patch: {
          rateToBase: rate,
          ...(baseAmountMinor !== undefined ? { baseAmountMinor } : {}),
          rateSource: "group",
        },
      };
    });
  },
});

/**
 * Every invariant the app repairs. Order must not matter: healers that fight
 * are an op loop that syncs. The property test proves a fixed point exists.
 */
export const INVARIANTS: readonly RegisteredInvariant[] = [
  liveEntriesNameLiveMembers,
  entriesCarryTheirOwnRate,
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
