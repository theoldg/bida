import { compareHlc, maxHlc, type Hlc } from "./hlc.js";
import { IMMUTABLE_FIELDS, WRITE_ONCE_FIELDS, type Op } from "./ops.js";
import { upgradeReceiptSplit } from "./split.js";
import {
  emptyGroupState,
  type Attachment, type Expense, type Group, type GroupState,
  type Id, type Identity, type Member, type Settlement,
} from "./types.js";

/**
 * State is a deterministic fold over the op log, ordered by HLC — never by
 * seq (server arrival) or createdAt (a phone's opinion). ADR-0002.
 *
 * The fold is TOTAL: any subset of ops in any order gives a valid state (an
 * update before its create is a partial entity). Never throw on a surprising
 * op — one bad row would brick the app.
 */

export function sortOps(ops: readonly Op[]): Op[] {
  return [...ops].sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Bag = Record<string, unknown>;

/**
 * Apply a patch: `IMMUTABLE_FIELDS` never, `WRITE_ONCE_FIELDS` only if unset.
 * Also upgrades older op shapes. Exported so history folds identically — a
 * second copy of these rules is a second answer to what the log means.
 */
export function applyPatch(target: Bag, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (IMMUTABLE_FIELDS.has(key)) continue;
    if (WRITE_ONCE_FIELDS.has(key) && target[key] !== undefined && target[key] !== null) continue;
    target[key] = value;
  }
  upgradeReceiptSplit(target);
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
    // Applies like an update; history is never rewound.
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
 * Fold new ops onto a state. Only valid if every op sorts after
 * `state.lastHlc`; otherwise returns null and the caller re-folds.
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

export type { Attachment, Expense, Group, GroupState, Identity, Member, Settlement };
