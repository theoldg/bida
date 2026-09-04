import { compareHlc, maxHlc, type Hlc } from "./hlc.js";
import { IMMUTABLE_FIELDS, type Op } from "./ops.js";
import {
  emptyGroupState,
  type Attachment, type Expense, type Group, type GroupState,
  type Id, type Identity, type Member, type Settlement,
} from "./types.js";

/**
 * State is a deterministic fold over the op log. Ordering is by HLC, always —
 * never by seq (that is arrival order at the server) and never by createdAt
 * (that is a phone's opinion of the time). See ADR-0002.
 *
 * The fold is TOTAL: any subset of ops, in any order, produces some valid
 * state. An update arriving before its create yields a partial entity that
 * completes when the create lands. Never throw on a surprising op — a throw
 * here bricks the whole app for one bad row.
 */

export function sortOps(ops: readonly Op[]): Op[] {
  return [...ops].sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Bag = Record<string, unknown>;

function applyPatch(target: Bag, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (IMMUTABLE_FIELDS.has(key)) continue;
    target[key] = value;
  }
}

function bucketFor(state: GroupState, entity: Op["entity"]): Record<Id, Bag> | null {
  switch (entity) {
    case "member": return state.members as unknown as Record<Id, Bag>;
    case "expense": return state.expenses as unknown as Record<Id, Bag>;
    case "settlement": return state.settlements as unknown as Record<Id, Bag>;
    case "attachment": return state.attachments as unknown as Record<Id, Bag>;
    case "identity": return state.identities as unknown as Record<Id, Bag>;
    case "rate": return state.rates as unknown as Record<Id, Bag>;
    case "group": return null;
  }
}

function applyOp(state: GroupState, op: Op): void {
  if (op.entity === "group") {
    const current: Bag =
      (state.group as unknown as Bag) ?? { id: op.entityId, createdAt: op.createdAt };
    if (op.kind === "delete") current["archivedAt"] = op.createdAt;
    else applyPatch(current, op.patch);
    current["id"] = op.entityId;
    state.group = current as unknown as Group;
    return;
  }

  const bucket = bucketFor(state, op.entity);
  if (!bucket) return;

  const existing = bucket[op.entityId];
  const target: Bag = existing ?? { id: op.entityId, groupId: op.groupId };

  switch (op.kind) {
    case "create":
    case "update":
    // A restore carries the resolved field values of the revision being
    // restored, so it applies exactly like an update. History is never rewound.
    case "restore":
      applyPatch(target, op.patch);
      break;
    case "delete":
      target["deletedAt"] = op.createdAt;
      break;
  }

  bucket[op.entityId] = target;
}

export function foldOps(ops: readonly Op[]): GroupState {
  const state = emptyGroupState();
  let last: Hlc | undefined;
  for (const op of sortOps(ops)) {
    applyOp(state, op);
    last = maxHlc(last, op.hlc);
  }
  state.lastHlc = last;
  return state;
}

/**
 * Fold an already-folded state forward with new ops. Only valid when every op
 * in `incoming` sorts after `state.lastHlc` — otherwise a later write could be
 * clobbered by an earlier one arriving late. Returns null when that isn't the
 * case, and the caller must re-fold from scratch.
 */
export function foldForward(state: GroupState, incoming: readonly Op[]): GroupState | null {
  const sorted = sortOps(incoming);
  if (state.lastHlc !== undefined) {
    for (const op of sorted) {
      if (compareHlc(op.hlc, state.lastHlc) <= 0) return null;
    }
  }
  let last = state.lastHlc;
  for (const op of sorted) {
    applyOp(state, op);
    last = maxHlc(last, op.hlc);
  }
  state.lastHlc = last;
  return state;
}

export type {
  Attachment, ExchangeRate, Expense, Group, GroupState, Identity, Member, Settlement,
};
