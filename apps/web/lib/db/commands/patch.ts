// Doc: docs/sync.md#the-operation
/**
 * What a patch is allowed to carry, which is the merge rule. **Every editor
 * patches through here**, or the copies drift.
 */

/**
 * Fields a content save never carries, whatever the form holds. `id`/`groupId`
 * the fold refuses anyway; `createdAt`/`deletedAt` it would take. `rev` is the
 * row's, not the entity's (lib/db/fold.ts).
 */
const NOT_CONTENT = new Set(["id", "groupId", "createdAt", "deletedAt", "rev"]);

/**
 * The entries that actually carry something. A `create` omits fields it would
 * only be defaulting — the fold reads absent as default, and eight such nulls
 * are a quarter of an ordinary expense op (ADR-0002).
 *
 * **Only a create may do this.** In an `update` absent means "leave it alone",
 * so clearing a field there must write the null.
 */
export function only(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The whole of an entry's content, as an `update` patch: every content field,
 * moved or not. Absent fields are written as explicit `null`, since leaving
 * them off would mean "leave it alone" — per-field merging again.
 */
export function wholeEntity(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (NOT_CONTENT.has(key)) continue;
    out[key] = value === undefined ? null : value;
  }
  return out;
}

/**
 * Did this save move anything? A whole patch names every field, so it can't
 * say — and a no-op op is a history row saying nothing happened.
 */
export function movesAnything(existing: object, whole: Record<string, unknown>): boolean {
  const held = existing as Record<string, unknown>;
  return Object.entries(whole).some(([key, value]) => !sameValue(value, held[key]));
}

/** JSON with object keys in a fixed order, so `{a,b}` and `{b,a}` compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>).sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v);
}

/**
 * Is this the value the entity already holds? **`null` and absent are the same
 * value — not set**: `only()` omits unset fields on create while the form sends
 * `null`, so otherwise every first edit writes a phantom revision.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  return stableJson(a) === stableJson(b);
}

