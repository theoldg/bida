import { convertMinor, type CurrencyCode, type Rate } from "./money.js";
import type { EntityKind, OpKind } from "./ops.js";
import { memberInvolved } from "./payers.js";
import { rateFor } from "./rates.js";
import {
  alive, type Expense, type GroupState, type Id, type Member, type Settlement,
} from "./types.js";

/**
 * A healer must detect a *state*, not a race; write ordinary ops; be idempotent
 * and deterministic; and name the cause, not an actor. `invariants.test.ts`
 * enforces it ([docs/invariants.md](../../../docs/invariants.md)).
 */

export interface OpDraft {
  entity: EntityKind;
  entityId: Id;
  kind: OpKind;
  patch: Record<string, unknown>;
  note?: string | null;
}

/**
 * `repair` is handed only the detector's output, so it can't consult state the
 * detector never looked at.
 */
interface Invariant<V> {
  readonly name: string;
  readonly holds: string;
  detect(state: GroupState): V[];
  repair(violations: readonly V[]): OpDraft[];
  /** A courtesy refusal from this device's snapshot — never correctness. */
  wouldViolate?(state: GroupState, draft: OpDraft): boolean;
}

interface Declared<V> extends Invariant<V> {
  wouldViolate(state: GroupState, draft: OpDraft): boolean;
}

export type RegisteredInvariant = Declared<unknown>;

function defineInvariant<V>(spec: Invariant<V>): Declared<V> {
  return {
    ...spec,
    wouldViolate: (state, draft) => spec.wouldViolate?.(state, draft) ?? false,
  };
}

/** The tombstone gives way: an entry is money somebody typed. */
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

interface RegistryValued {
  entity: "expense" | "settlement";
  entry: Expense | Settlement;
  rate: Rate;
  base: CurrencyCode;
}

/**
 * A registry row moved since prices nothing it already wrote, so only the
 * repair's own mark on another currency's rate counts as stale.
 */
function staleGroupRate(state: GroupState, base: CurrencyCode, entry: Expense | Settlement, rate: Rate): boolean {
  if (entry.rateSource !== "group" || entry.rateToBase === rate) return false;
  return Object.keys(state.rates).some((other) =>
    other !== entry.currency && rateFor(state.rates, base, other) === entry.rateToBase);
}

export const entriesCarryTheirOwnRate = defineInvariant<RegistryValued>({
  name: "entriesCarryTheirOwnRate",
  holds: "A foreign entry the registry has a rate for carries its own",
  detect(state) {
    const base = state.group?.baseCurrency;
    if (!base) return [];
    const found: RegistryValued[] = [];
    const scan = (entity: RegistryValued["entity"], rows: Record<Id, Expense | Settlement>) => {
      for (const entry of Object.values(rows)) {
        if (entry.currency === base) continue;
        const rate = rateFor(state.rates, base, entry.currency);
        if (rate === undefined) continue;
        if (!entry.rateSource || staleGroupRate(state, base, entry, rate)) {
          found.push({ entity, entry, rate, base });
        }
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

/** Order must not matter: healers that fight are an op loop that syncs. */
export const INVARIANTS: readonly RegisteredInvariant[] = [
  liveEntriesNameLiveMembers,
  entriesCarryTheirOwnRate,
];

export function healDrafts(state: GroupState): OpDraft[] {
  const drafts: OpDraft[] = [];
  for (const invariant of INVARIANTS) {
    const violations = invariant.detect(state);
    if (violations.length > 0) drafts.push(...invariant.repair(violations));
  }
  return drafts;
}

export function wouldViolate(state: GroupState, draft: OpDraft): RegisteredInvariant | undefined {
  return INVARIANTS.find((i) => i.wouldViolate(state, draft));
}

/**
 * Not in `INVARIANTS`: registered, every device would resurrect every claimed
 * member and no removal would stick.
 */
export function restoreClaimDrafts(state: GroupState, memberId: Id): OpDraft[] {
  const member = state.members[memberId];
  if (!member?.deletedAt) return [];
  return [{ entity: "member", entityId: memberId, kind: "update", patch: { deletedAt: null } }];
}
