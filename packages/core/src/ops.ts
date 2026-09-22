import { isHlc, type Hlc } from "./hlc.js";
import type { Id } from "./types.js";

/**
 * Nothing is ever mutated in place. Every change is one of these, appended to a
 * per-group log. The log is the sync wire format, the offline write buffer and
 * the version history all at once. See ADR-0002.
 */

export type EntityKind =
  | "group" | "member" | "expense" | "settlement" | "attachment"
  /** A device's claim to be a member. Shared so `actor` can be read. ADR-0003. */
  | "identity"
  /** One currency's rate to the group's base. Entity id is the code. ADR-0005. */
  | "rate";
export type OpKind = "create" | "update" | "delete" | "restore";

export interface Op {
  /** Client-generated UUID. Doubles as the idempotency key on push. */
  id: Id;
  groupId: Id;
  entity: EntityKind;
  entityId: Id;
  kind: OpKind;
  /** Changed fields ONLY. Never the whole entity — that is what makes
   *  concurrent edits to different fields merge instead of clobber. */
  patch: Record<string, unknown>;
  hlc: Hlc;
  /** memberId that made the change. */
  actor: Id;
  /** Optional human reason, surfaced in history: "forgot the rug". */
  note?: string | null;
  /** Wall clock, for DISPLAY ONLY. Never sort by this. */
  createdAt: number;
  /** Assigned by the server on accept. Absent means not yet synced. */
  seq?: number | null;
}

const ENTITIES: readonly EntityKind[] = [
  "group", "member", "expense", "settlement", "attachment", "identity", "rate",
];
const KINDS: readonly OpKind[] = ["create", "update", "delete", "restore"];

/** Fields the fold refuses to take from a patch — identity and bookkeeping. */
export const IMMUTABLE_FIELDS = new Set(["id", "groupId"]);

/**
 * Fields a patch may set once and never change: the first value the log carries
 * wins, whatever arrives later.
 *
 * `createdAt` breaks ties between same-day entries in list order, so an edit
 * must leave it alone. The rule is held here and not merely documented: an
 * entry's content is written whole (docs/sync.md), so every edit carries one.
 */
export const WRITE_ONCE_FIELDS = new Set(["createdAt"]);

class OpValidationError extends Error {}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new OpValidationError(`op.${field} must be a non-empty string`);
  }
  return v;
}

/**
 * Validate an op arriving from anywhere untrusted — the network, IndexedDB
 * written by an older version of the app, a test fixture.
 */
export function validateOp(input: unknown): Op {
  if (typeof input !== "object" || input === null) {
    throw new OpValidationError("op must be an object");
  }
  const o = input as Record<string, unknown>;
  const entity = str(o["entity"], "entity") as EntityKind;
  if (!ENTITIES.includes(entity)) throw new OpValidationError(`unknown entity: ${entity}`);
  const kind = str(o["kind"], "kind") as OpKind;
  if (!KINDS.includes(kind)) throw new OpValidationError(`unknown kind: ${kind}`);
  const patch = o["patch"];
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new OpValidationError("op.patch must be a plain object");
  }
  const createdAt = o["createdAt"];
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    throw new OpValidationError("op.createdAt must be a finite number");
  }
  const seq = o["seq"];
  if (seq !== undefined && seq !== null && typeof seq !== "number") {
    throw new OpValidationError("op.seq must be a number, null or absent");
  }
  // Not trusted as any string: a stamp is what the fold sorts on and what
  // `hlcReceive` adopts, and one it could not parse threw inside the sync
  // commit on every retry, for every phone in the group.
  const hlc = str(o["hlc"], "hlc");
  if (!isHlc(hlc)) throw new OpValidationError(`op.hlc is not a stamp this clock can adopt: ${hlc}`);
  const note = o["note"];
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw new OpValidationError("op.note must be a string, null or absent");
  }
  return {
    id: str(o["id"], "id"),
    groupId: str(o["groupId"], "groupId"),
    entity,
    entityId: str(o["entityId"], "entityId"),
    kind,
    patch: patch as Record<string, unknown>,
    hlc,
    actor: str(o["actor"], "actor"),
    note: (note as string | null | undefined) ?? null,
    createdAt,
    seq: (seq as number | null | undefined) ?? null,
  };
}
